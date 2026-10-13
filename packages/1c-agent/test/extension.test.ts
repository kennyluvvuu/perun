import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
	ToolCallEvent,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { createOnecAgentExtension } from "../src/index.ts";

function setupExtensionTest() {
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

	const extension = createOnecAgentExtension({ initialMode: "write" });
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
		const { registeredTools, registeredCommands, registeredShortcuts, eventHandlers } = setupExtensionTest();

		// Check tools
		expect(registeredTools.has("1c_call_hierarchy")).toBe(true);
		expect(registeredTools.has("1c_impact_analysis")).toBe(true);
		expect(registeredTools.has("1c_ast_symbols")).toBe(true);
		expect(registeredTools.has("bsl_fix_standards")).toBe(true);
		expect(registeredTools.has("1c_subagent")).toBe(true);

		// Check commands and shortcut
		expect(registeredCommands.has("mode")).toBe(true);
		expect(registeredCommands.has("permission")).toBe(true);
		expect(registeredShortcuts.has("alt+m")).toBe(true);

		// Check event subscriptions
		expect(eventHandlers.has("session_start")).toBe(true);
		expect(eventHandlers.has("session_shutdown")).toBe(true);
		expect(eventHandlers.has("before_agent_start")).toBe(true);
		expect(eventHandlers.has("tool_call")).toBe(true);
		expect(eventHandlers.has("tool_result")).toBe(true);
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

	it("injects mode instructions on before_agent_start", async () => {
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
			} as any,
		};

		await beforeStartHandler!(event);
		expect(event.systemPromptOptions.promptGuidelines[0]).toContain("[РЕЖИМ: ОБЪЯСНИТЬ (DOCUMENT & EXPLAIN)]");
	});

	it("initializes UI status on session_start", async () => {
		const { eventHandlers, ctx } = setupExtensionTest();
		const sessionStartHandler = eventHandlers.get("session_start")?.[0];
		expect(sessionStartHandler).toBeDefined();

		await sessionStartHandler!({ type: "session_start" } as SessionStartEvent, ctx);

		expect(ctx.ui.setStatus).toHaveBeenCalledWith("1c-mode", "[1C: НАПИСАТЬ]");
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("1c-permissions", "[Права: AUTO-APPROVE]");
	});
});
