import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ModeManager } from "../src/modes/index.ts";
import { MODE_CYCLE_ORDER, MUTATING_TOOLS } from "../src/modes/types.ts";
import type { AgentMode } from "../src/types.ts";

function createMockExtensionAPI() {
	let activeTools: string[] = ["read", "bash", "edit", "write", "find", "grep"];
	return {
		getActiveTools: vi.fn(() => [...activeTools]),
		setActiveTools: vi.fn((tools: string[]) => {
			activeTools = [...tools];
		}),
	} as unknown as ExtensionAPI;
}

function createMockContext() {
	const statusMap = new Map<string, string | undefined>();
	return {
		hasUI: true,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn((id: string, text: string | undefined) => {
				statusMap.set(id, text);
			}),
			theme: {
				fg: (_color: string, text: string) => text,
			},
		},
		statusMap,
	} as unknown as ExtensionContext & { statusMap: Map<string, string | undefined> };
}

describe("1C Agent Modes", () => {
	it("initializes with default mode and config", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "write");

		expect(manager.getMode()).toBe("write");
		expect(manager.getConfig().title).toBe("НАПИСАТЬ");
		expect(manager.getConfig().isReadOnly).toBe(false);
	});

	it("MUTATING_TOOLS contains all required mutating tools", () => {
		expect(MUTATING_TOOLS).toContain("edit");
		expect(MUTATING_TOOLS).toContain("write");
		expect(MUTATING_TOOLS).toContain("bash");
		expect(MUTATING_TOOLS).toContain("bsl_fix_standards");
		expect(MUTATING_TOOLS).toContain("1c_vanessa");
		expect(MUTATING_TOOLS).toContain("1c_skill_execute");
	});

	it("cycles through all modes in correct order", () => {
		const api = createMockExtensionAPI();
		const ctx = createMockContext();
		const manager = new ModeManager(api, "find");

		const visited: AgentMode[] = [manager.getMode()];
		for (let i = 0; i < MODE_CYCLE_ORDER.length; i++) {
			const next = manager.cycleMode(ctx);
			visited.push(next);
		}

		expect(visited).toEqual(["find", "explain", "write", "plan", "find"]);
	});

	it("blocks mutating tools in read-only modes (НАЙТИ, ОБЪЯСНИТЬ, ПЛАНИРОВАТЬ)", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "find");

		// find mode
		expect(manager.isToolAllowed("read")).toBe(true);
		expect(manager.isToolAllowed("find")).toBe(true);
		expect(manager.isToolAllowed("1c_call_hierarchy")).toBe(true);
		expect(manager.isToolAllowed("edit")).toBe(false);
		expect(manager.isToolAllowed("write")).toBe(false);
		expect(manager.isToolAllowed("bash")).toBe(false);
		expect(manager.isToolAllowed("bsl_fix_standards")).toBe(false);
		expect(manager.isToolAllowed("1c_vanessa")).toBe(false);
		expect(manager.isToolAllowed("1c_skill_execute")).toBe(false);

		const blockCheck = manager.checkToolCall("edit");
		expect(blockCheck.block).toBe(true);
		expect(blockCheck.reason).toContain("заблокирован в режиме [НАЙТИ]");

		// explain mode
		manager.setMode("explain");
		expect(manager.checkToolCall("write").block).toBe(true);
		expect(manager.checkToolCall("bash").block).toBe(true);
		expect(manager.checkToolCall("1c_skill_execute").block).toBe(true);
		expect(manager.checkToolCall("bsl_fix_standards").block).toBe(true);
		expect(manager.checkToolCall("1c_vanessa").block).toBe(true);
		expect(manager.checkToolCall("edit").block).toBe(true);
		expect(manager.checkToolCall("read").block).toBe(false);
		expect(manager.checkToolCall("1c_ast_symbols").block).toBe(false);

		// plan mode
		manager.setMode("plan");
		expect(manager.checkToolCall("edit").block).toBe(true);
		expect(manager.checkToolCall("bash").block).toBe(true);
		expect(manager.checkToolCall("1c_skill_execute").block).toBe(true);
		expect(manager.checkToolCall("read").block).toBe(false);
	});

	it("allows all tools in НАПИСАТЬ mode", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "write");

		expect(manager.isToolAllowed("read")).toBe(true);
		expect(manager.isToolAllowed("edit")).toBe(true);
		expect(manager.isToolAllowed("write")).toBe(true);
		expect(manager.isToolAllowed("bash")).toBe(true);
		expect(manager.isToolAllowed("1c_skill_execute")).toBe(true);
		expect(manager.isToolAllowed("bsl_fix_standards")).toBe(true);
		expect(manager.isToolAllowed("1c_vanessa")).toBe(true);
		expect(manager.checkToolCall("write").block).toBe(false);
		expect(manager.checkToolCall("bash").block).toBe(false);
		expect(manager.checkToolCall("1c_skill_execute").block).toBe(false);
	});

	it("keeps toolset stable without deleting tools from registry, blocking via checkToolCall", () => {
		const api = createMockExtensionAPI();
		const ctx = createMockContext();
		const manager = new ModeManager(api, "write");

		manager.setMode("find", ctx);
		// Does not delete tools from registry via setActiveTools to prevent "Tool bash not found"
		expect(api.setActiveTools).not.toHaveBeenCalled();

		// Mutating tools are blocked via checkToolCall
		expect(manager.checkToolCall("bash").block).toBe(true);
		expect(manager.checkToolCall("1c_skill_execute").block).toBe(true);
		expect(manager.checkToolCall("edit").block).toBe(true);
		expect(manager.checkToolCall("write").block).toBe(true);
		expect(manager.checkToolCall("bsl_fix_standards").block).toBe(true);
		expect(manager.checkToolCall("1c_vanessa").block).toBe(true);

		// Read-only tools are allowed
		expect(manager.checkToolCall("read").block).toBe(false);
		expect(manager.checkToolCall("find").block).toBe(false);
		expect(manager.checkToolCall("grep").block).toBe(false);
	});

	it("updates UI status badge on mode change", () => {
		const api = createMockExtensionAPI();
		const ctx = createMockContext();
		const manager = new ModeManager(api, "find");

		manager.updateUI(ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("1c-mode", "[1C: НАЙТИ]");

		manager.setMode("write", ctx);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("1c-mode", "[1C: НАПИСАТЬ]");
	});

	it("provides tailored system prompt injection per mode", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "find");

		expect(manager.getSystemPromptInjection()).toContain("[РЕЖИМ: НАЙТИ (EXPLORE)]");

		manager.setMode("explain");
		expect(manager.getSystemPromptInjection()).toContain("[РЕЖИМ: ОБЪЯСНИТЬ (DOCUMENT & EXPLAIN)]");

		manager.setMode("write");
		expect(manager.getSystemPromptInjection()).toContain("[РЕЖИМ: НАПИСАТЬ (CODE & REFACTOR)]");

		manager.setMode("plan");
		expect(manager.getSystemPromptInjection()).toContain("[РЕЖИМ: ПЛАНИРОВАТЬ (ARCHITECT & PLAN)]");
	});

	it("all mode system prompts specify toolchain-resolver, cc-1c-skills, and 1c_vanessa actions", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "find");

		for (const mode of ["find", "explain", "write", "plan"] as const) {
			manager.setMode(mode);
			const prompt = manager.getSystemPromptInjection();
			expect(prompt).toContain("TOOLCHAIN-RESOLVER");
			expect(prompt).toContain("CC-1C-SKILLS");
			expect(prompt).toContain("1c_vanessa");
			expect(prompt).toContain("init-dev");
			expect(prompt).toContain("load");
			expect(prompt).toContain("dump");
			expect(prompt).toContain("updatedb");
			expect(prompt).toContain("test");
		}
	});

	it("explain mode prompt enforces 5-part response contract and write mode transition for fixes", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "explain");
		const prompt = manager.getSystemPromptInjection();

		expect(prompt).toContain("ЖЕСТКИЙ 5-ЧАСТНЫЙ КОНТРАКТ ОТВЕТА");
		expect(prompt).toContain("1. Симптом");
		expect(prompt).toContain("2. Трасса");
		expect(prompt).toContain("3. Причина");
		expect(prompt).toContain("4. Следствия");
		expect(prompt).toContain("5. Верификация");
		expect(prompt).toContain("СТРОГОЕ ПРАВИЛО ДЛЯ БЛОКА «КАК ИСПРАВИТЬ»");
		expect(prompt).toContain("НАПИСАТЬ");
	});

	it("all mode system prompts include language pin, artifact boundary, and disk search ban rules", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "find");

		for (const mode of ["find", "explain", "write", "plan"] as const) {
			manager.setMode(mode);
			const prompt = manager.getSystemPromptInjection();
			expect(prompt).toContain("ПИН ЯЗЫКА ОТВЕТА");
			expect(prompt).toContain("ГРАНИЦЫ ЗАДАЧИ И АРТЕФАКТА");
			expect(prompt).toContain("СТРОГИЙ ЗАПРЕТ СКАНИРОВАНИЯ ДИСКА И РЕВЕРС-ИНЖИНИРИНГА");
			expect(prompt).toContain("find /");
			expect(prompt).toContain("strings");
			expect(prompt).toContain("otool");
		}
	});
});
