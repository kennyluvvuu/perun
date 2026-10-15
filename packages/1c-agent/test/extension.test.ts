import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	ResourcesDiscoverEvent,
	SessionStartEvent,
	ToolCallEvent,
	ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createOnecAgentExtension, detect1cProject, type OnecAgentExtensionOptions } from "../src/index.ts";

function setupExtensionTest(options: OnecAgentExtensionOptions = { initialMode: "write" }) {
	const registeredTools = new Map<string, any>();
	const registeredCommands = new Map<string, any>();
	const eventHandlers = new Map<string, Array<(...args: any[]) => any>>();
	const registeredShortcuts = new Map<string, any>();

	const mockPi = {
		registerTool: vi.fn((tool) => {
			registeredTools.set(tool.name, tool);
		}),
		registerCommand: vi.fn((name, cmd) => {
			registeredCommands.set(name, cmd);
		}),
		registerShortcut: vi.fn((shortcut, opts) => {
			registeredShortcuts.set(shortcut, opts);
		}),
		on: vi.fn((event, handler) => {
			const list = eventHandlers.get(event) ?? [];
			list.push(handler);
			eventHandlers.set(event, list);
			return () => {};
		}),
		getActiveTools: vi.fn(() => [
			"read",
			"find",
			"grep",
			"edit",
			"write",
			"bsl_fix_standards",
			"1c_call_hierarchy",
			"1c_impact_analysis",
			"1c_ast_symbols",
			"1c_subagent",
			"1c_skill_execute",
		]),
		setActiveTools: vi.fn(),
	} as unknown as ExtensionAPI;

	const ctx = {
		hasUI: true,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			confirm: vi.fn(async () => true),
			theme: {
				fg: (_c: string, text: string) => text,
			},
		},
	} as unknown as ExtensionContext;

	const extension = createOnecAgentExtension(options);
	const instance = extension(mockPi);

	return {
		mockPi,
		ctx,
		registeredTools,
		registeredCommands,
		registeredShortcuts,
		eventHandlers,
		instance,
	};
}

describe("1C Agent Extension Integration", () => {
	it("registers all required tools, commands, shortcuts, and lifecycle handlers", () => {
		const { registeredTools, registeredCommands, registeredShortcuts, eventHandlers, ctx } = setupExtensionTest();

		// Check tools
		expect(registeredTools.has("1c_call_hierarchy")).toBe(true);
		expect(registeredTools.has("1c_impact_analysis")).toBe(true);
		expect(registeredTools.has("1c_ast_symbols")).toBe(true);
		expect(registeredTools.has("bsl_fix_standards")).toBe(true);
		expect(registeredTools.has("1c_subagent")).toBe(true);
		expect(registeredTools.has("1c_vanessa")).toBe(true);
		expect(registeredTools.has("1c_skill_execute")).toBe(true);
		expect(registeredTools.has("1c_git_blame_context")).toBe(true);
		expect(registeredTools.has("1c_git_docgen")).toBe(true);

		// Check commands and shortcut
		expect(registeredCommands.has("mode")).toBe(true);
		expect(registeredCommands.has("permission")).toBe(true);
		expect(registeredCommands.has("doctor")).toBe(true);
		expect(registeredCommands.has("docgen")).toBe(true);
		expect(registeredShortcuts.has("alt+m")).toBe(true);

		// Check event subscriptions
		expect(eventHandlers.has("session_start")).toBe(true);
		expect(eventHandlers.has("session_shutdown")).toBe(true);
		expect(eventHandlers.has("before_agent_start")).toBe(true);
		expect(eventHandlers.has("tool_call")).toBe(true);
		expect(eventHandlers.has("tool_result")).toBe(true);
		expect(eventHandlers.has("resources_discover")).toBe(true);

		// Check resources_discover provides skills
		const resourcesDiscoverHandler = eventHandlers.get("resources_discover")?.[0];
		expect(resourcesDiscoverHandler).toBeDefined();
		const discoverEvent: ResourcesDiscoverEvent = {
			type: "resources_discover",
			cwd: process.cwd(),
			reason: "startup",
		};
		const discoverResult = resourcesDiscoverHandler!(discoverEvent, ctx);
		expect(discoverResult?.skillPaths?.length).toBeGreaterThan(0);

		// Verify skills directory contains 81 valid 1C skills with SKILL.md
		const skillsDir = discoverResult!.skillPaths![0];
		expect(fs.existsSync(skillsDir)).toBe(true);
		const skillDirs = fs.readdirSync(skillsDir).filter((name) => {
			const skillMd = path.join(skillsDir, name, "SKILL.md");
			return fs.existsSync(skillMd);
		});
		expect(skillDirs.length).toBe(81);
	});

	it("integrates mode switching with tool_call blocking", async () => {
		const { instance, eventHandlers, ctx } = setupExtensionTest();
		const toolCallHandler = eventHandlers.get("tool_call")?.[0];
		expect(toolCallHandler).toBeDefined();

		// Initially in write mode: write is allowed
		const writeEvent: ToolCallEvent = {
			type: "tool_call",
			toolName: "write",
			toolCallId: "call_write",
			input: { path: "Module.bsl" },
		};
		const resultInWrite = await toolCallHandler!(writeEvent, ctx);
		expect(resultInWrite).toBeUndefined(); // not blocked

		// Switch to find mode (read-only)
		instance.modeManager.setMode("find", ctx);

		const resultInFind = await toolCallHandler!(writeEvent, ctx);
		expect(resultInFind).toEqual({
			block: true,
			reason: expect.stringContaining("заблокирован в режиме [НАЙТИ]"),
		});
	});

	it("injects mode instructions and security/language rules on before_agent_start", async () => {
		const { instance, eventHandlers } = setupExtensionTest();
		const beforeStartHandler = eventHandlers.get("before_agent_start")?.[0];
		expect(beforeStartHandler).toBeDefined();

		instance.modeManager.setMode("explain");

		const event: BeforeAgentStartEvent = {
			type: "before_agent_start",
			messageType: "user",
			prompt: "Объясни процедуру проведения",
			systemPrompt: "Base prompt",
			systemPromptOptions: {
				promptGuidelines: [],
				sections: {},
			} as any,
		};

		await beforeStartHandler!(event);
		expect(event.systemPromptOptions.promptGuidelines[0]).toContain("[РЕЖИМ: ОБЪЯСНИТЬ (DOCUMENT & EXPLAIN)]");
		expect(event.systemPromptOptions.sections.onec_environment).toContain("ПИН ЯЗЫКА ОТВЕТА");
		expect(event.systemPromptOptions.sections.onec_environment).toContain("ГРАНИЦЫ ЗАДАЧИ И АРТЕФАКТА");
		expect(event.systemPromptOptions.sections.onec_environment).toContain(
			"СТРОГИЙ ЗАПРЕТ СКАНИРОВАНИЯ ДИСКА И РЕВЕРС-ИНЖИНИРИНГА",
		);
		expect(event.systemPromptOptions.sections.onec_environment).toContain("find /");
		expect(event.systemPromptOptions.sections.onec_environment).toContain("strings");
		expect(event.systemPromptOptions.sections.onec_environment).toContain("otool");
	});

	it("initializes UI status on session_start", async () => {
		const { eventHandlers, ctx } = setupExtensionTest();
		const sessionStartHandler = eventHandlers.get("session_start")?.[0];
		expect(sessionStartHandler).toBeDefined();

		await sessionStartHandler!({ type: "session_start" } as SessionStartEvent, ctx);

		expect(ctx.ui.setStatus).toHaveBeenCalledWith("1c-mode", "[1C: НАПИСАТЬ]");
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("1c-permissions", "[Права: AUTO-APPROVE]");
	});

	it("detects 1C project with Configuration.xml, Configuration.mdo, and recursive .bsl/.os files", async () => {
		const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "1c-detect-test-"));

		try {
			// Initially empty -> false
			expect(await detect1cProject(tempDir)).toBe(false);

			// Non-1C files -> false
			await fs.promises.writeFile(path.join(tempDir, "package.json"), "{}");
			await fs.promises.writeFile(path.join(tempDir, "index.ts"), "export {}");
			expect(await detect1cProject(tempDir)).toBe(false);

			// Configurator in src/: src/Configuration.xml -> true
			const srcDir = path.join(tempDir, "src");
			await fs.promises.mkdir(srcDir, { recursive: true });
			const configXml = path.join(srcDir, "Configuration.xml");
			await fs.promises.writeFile(configXml, "<MetaDataObject/>");
			expect(await detect1cProject(tempDir)).toBe(true);

			// Remove Configuration.xml
			await fs.promises.unlink(configXml);
			expect(await detect1cProject(tempDir)).toBe(false);

			// EDT in src/: src/Configuration.mdo -> true
			const configMdo = path.join(srcDir, "Configuration.mdo");
			await fs.promises.writeFile(configMdo, "<mdclass:Configuration/>");
			expect(await detect1cProject(tempDir)).toBe(true);

			await fs.promises.unlink(configMdo);
			expect(await detect1cProject(tempDir)).toBe(false);

			// Recursive .bsl files at depth 2: src/Documents/Order.bsl -> true
			const docsDir = path.join(srcDir, "Documents");
			await fs.promises.mkdir(docsDir, { recursive: true });
			const bslFile = path.join(docsDir, "Order.bsl");
			await fs.promises.writeFile(bslFile, "Процедура Тест() КонецПроцедуры");
			expect(await detect1cProject(tempDir)).toBe(true);
		} finally {
			await fs.promises.rm(tempDir, { recursive: true, force: true });
		}
	});

	it("lazily starts LSP client upon writing .bsl file if not already running", async () => {
		const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "1c-lazy-start-test-"));

		try {
			const { instance, eventHandlers } = setupExtensionTest({
				projectRoot: tempDir,
				initialMode: "write",
			});

			const startSpy = vi.spyOn(instance.lspClient, "start").mockResolvedValue(true);
			vi.spyOn(instance.lspClient, "isReady").mockReturnValue(false);

			// Create a .bsl file in the project
			const bslPath = path.join(tempDir, "Module.bsl");
			await fs.promises.writeFile(bslPath, "Процедура Тест() КонецПроцедуры");

			const toolResultHandler = eventHandlers.get("tool_result")?.[0];
			expect(toolResultHandler).toBeDefined();

			const event: ToolResultEvent = {
				type: "tool_result",
				toolName: "write",
				toolCallId: "call_lazy_1",
				input: { path: bslPath },
				content: [{ type: "text", text: "Successfully saved" }],
				isError: false,
				details: undefined,
			};

			await toolResultHandler!(event);

			// LSP start should have been triggered
			expect(startSpy).toHaveBeenCalledWith(tempDir);
		} finally {
			await fs.promises.rm(tempDir, { recursive: true, force: true });
		}
	});
});
