import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { ModeManager } from "../src/modes/index.ts";
import { MODE_CYCLE_ORDER } from "../src/modes/types.ts";
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
		expect(manager.isToolAllowed("bsl_fix_standards")).toBe(false);

		const blockCheck = manager.checkToolCall("edit");
		expect(blockCheck.block).toBe(true);
		expect(blockCheck.reason).toContain("заблокирован в режиме [НАЙТИ]");

		// explain mode
		manager.setMode("explain");
		expect(manager.checkToolCall("write").block).toBe(true);

		// plan mode
		manager.setMode("plan");
		expect(manager.checkToolCall("edit").block).toBe(true);
	});

	it("allows all tools in НАПИСАТЬ mode", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "write");

		expect(manager.isToolAllowed("read")).toBe(true);
		expect(manager.isToolAllowed("edit")).toBe(true);
		expect(manager.isToolAllowed("write")).toBe(true);
		expect(manager.isToolAllowed("bsl_fix_standards")).toBe(true);
		expect(manager.checkToolCall("write").block).toBe(false);
	});

	it("filters active tools when switching mode", () => {
		const api = createMockExtensionAPI();
		const ctx = createMockContext();
		const manager = new ModeManager(api, "write");

		manager.setMode("find", ctx);
		expect(api.setActiveTools).toHaveBeenCalledWith(expect.arrayContaining(["read", "find", "grep"]));
		expect(api.setActiveTools).not.toHaveBeenCalledWith(expect.arrayContaining(["edit", "write"]));

		// Switching back to write restores full toolset
		manager.setMode("write", ctx);
		expect(api.setActiveTools).toHaveBeenLastCalledWith(
			expect.arrayContaining(["read", "edit", "write", "find", "grep"]),
		);
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
});
