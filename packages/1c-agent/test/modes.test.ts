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
		expect(MUTATING_TOOLS).toEqual(["edit", "write", "bash", "bsl_fix_standards", "1c_vanessa", "1c_git_docgen"]);
		expect(MUTATING_TOOLS).not.toContain("1c_skill_execute");
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

		for (const mode of ["find", "explain", "plan"] as const) {
			manager.setMode(mode);
			for (const tool of MUTATING_TOOLS) {
				expect(manager.checkToolCall(tool).block).toBe(true);
			}
			expect(manager.checkToolCall("read").block).toBe(false);
			expect(manager.checkToolCall("1c_ast_symbols").block).toBe(false);
		}
		manager.setMode("find");
		expect(manager.checkToolCall("edit").reason).toContain("заблокирован в режиме [НАЙТИ]");
	});

	it("lets read-only actions of 1c_md and 1c_ib through in read-only modes", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "plan");

		expect(manager.checkToolCall("1c_md", { action: "info" }).block).toBe(false);
		expect(manager.checkToolCall("1c_md", { action: "validate" }).block).toBe(false);
		expect(manager.checkToolCall("1c_md", { action: "create", object: "Справочник.Товары" }).block).toBe(true);
		expect(manager.checkToolCall("1c_md", { action: "add" }).block).toBe(true);
		expect(manager.checkToolCall("1c_md").block).toBe(true);
		expect(manager.checkToolCall("1c_ib", { action: "status" }).block).toBe(false);
		expect(manager.checkToolCall("1c_ib", { action: "build" }).block).toBe(true);
		expect(manager.checkToolCall("1c_ib", { action: "run" }).block).toBe(true);
	});

	it("allows all tools in НАПИСАТЬ mode", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "write");

		for (const tool of [...MUTATING_TOOLS, "read", "1c_md", "1c_ib"]) {
			expect(manager.checkToolCall(tool, { action: "create" }).block).toBe(false);
		}
	});

	it("keeps toolset stable without deleting tools from registry, blocking via checkToolCall", () => {
		const api = createMockExtensionAPI();
		const ctx = createMockContext();
		const manager = new ModeManager(api, "write");

		manager.setMode("find", ctx);
		expect(api.setActiveTools).not.toHaveBeenCalled();
		expect(manager.checkToolCall("bash").block).toBe(true);
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

	it("provides a short instruction per mode", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "find");
		const expected: Record<AgentMode, string> = {
			find: "Режим НАЙТИ",
			explain: "Режим ОБЪЯСНИТЬ",
			write: "Режим НАПИСАТЬ",
			plan: "Режим ПЛАНИРОВАТЬ",
		};
		for (const mode of MODE_CYCLE_ORDER) {
			manager.setMode(mode);
			const prompt = manager.getSystemPromptInjection();
			expect(prompt).toContain(expected[mode]);
			expect(prompt.length).toBeLessThan(600);
			expect(prompt).not.toMatch(/КАТЕГОРИЧЕСКИ|1c_skill_execute|1c_subagent|CC-1C-SKILLS/);
		}
	});

	it("read-only mode prompts state the restriction and explain mode points to НАПИСАТЬ for fixes", () => {
		const api = createMockExtensionAPI();
		const manager = new ModeManager(api, "explain");
		expect(manager.getSystemPromptInjection()).toContain("/mode write");
		for (const mode of ["find", "explain", "plan"] as const) {
			manager.setMode(mode);
			expect(manager.getSystemPromptInjection()).toContain("только чтение");
		}
	});
});
