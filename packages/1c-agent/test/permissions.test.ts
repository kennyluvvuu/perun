import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { PermissionPolicy } from "../src/permissions/policy.ts";
import { PermissionManager } from "../src/permissions/tools.ts";

function createMockContext(confirmed = true) {
	return {
		hasUI: true,
		ui: {
			confirm: vi.fn(async () => confirmed),
			notify: vi.fn(),
			setStatus: vi.fn(),
			theme: {
				fg: (_color: string, text: string) => text,
			},
		},
	} as unknown as ExtensionContext;
}

describe("1C Permission System", () => {
	it("allows everything without confirmation in YOLO mode", () => {
		const policy = new PermissionPolicy("yolo", "/project");

		expect(policy.checkToolCall("read", { path: "/project/a.bsl" })).toEqual({
			allowed: true,
			requiresUserConfirmation: false,
		});
		expect(policy.checkToolCall("write", { path: "/project/a.bsl" })).toEqual({
			allowed: true,
			requiresUserConfirmation: false,
		});
		expect(policy.checkToolCall("bash", { command: "rm -rf /" })).toEqual({
			allowed: true,
			requiresUserConfirmation: false,
		});
	});

	it("auto-approves safe reads and project file writes in AUTO-APPROVE mode", () => {
		const policy = new PermissionPolicy("auto-approve", "/project");

		// Safe reads are allowed
		expect(policy.checkToolCall("read", { path: "/project/Module.bsl" }).allowed).toBe(true);
		expect(policy.checkToolCall("grep", { query: "ВЫБРАТЬ" }).allowed).toBe(true);

		// Project writes are auto-approved
		expect(policy.checkToolCall("write", { path: "/project/Module.bsl" })).toEqual({
			allowed: true,
			requiresUserConfirmation: false,
		});

		// Writes outside project require confirmation
		const outsideWrite = policy.checkToolCall("write", { path: "/etc/passwd" });
		expect(outsideWrite.allowed).toBe(false);
		expect(outsideWrite.requiresUserConfirmation).toBe(true);

		// Sibling directory with matching prefix is NOT inside project
		const prefixEscapeWrite = policy.checkToolCall("write", { path: "/project-evil/Module.bsl" });
		expect(prefixEscapeWrite.allowed).toBe(false);
		expect(prefixEscapeWrite.requiresUserConfirmation).toBe(true);

		// Shell commands require confirmation
		const bashCheck = policy.checkToolCall("bash", { command: "git status" });
		expect(bashCheck.allowed).toBe(false);
		expect(bashCheck.requiresUserConfirmation).toBe(true);

		// Vanessa and Subagent tools are allowed in auto-approve
		expect(policy.checkToolCall("1c_vanessa", { action: "init-dev" }).allowed).toBe(true);
		expect(policy.checkToolCall("1c_subagent", { role: "1c-coder" }).allowed).toBe(true);
	});

	it("requires confirmation for all mutating operations in STRICT mode", () => {
		const policy = new PermissionPolicy("strict", "/project");

		// Reads are allowed without confirmation
		expect(policy.checkToolCall("read", { path: "/project/Module.bsl" }).allowed).toBe(true);

		// Writes require user confirmation
		const writeCheck = policy.checkToolCall("write", { path: "/project/Module.bsl" });
		expect(writeCheck.allowed).toBe(false);
		expect(writeCheck.requiresUserConfirmation).toBe(true);

		// Edits require confirmation
		const editCheck = policy.checkToolCall("edit", { path: "/project/Module.bsl" });
		expect(editCheck.allowed).toBe(false);
		expect(editCheck.requiresUserConfirmation).toBe(true);
	});

	it("blocks unconfirmed operations in PermissionManager", async () => {
		const manager = new PermissionManager("strict", "/project");
		const denyingCtx = createMockContext(false); // user clicks Cancel

		const result = await manager.handleToolCall(
			{ toolName: "write", input: { path: "/project/Module.bsl" } },
			denyingCtx,
		);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("действие не подтверждено пользователем");
	});

	it("allows confirmed operations in PermissionManager", async () => {
		const manager = new PermissionManager("strict", "/project");
		const acceptingCtx = createMockContext(true); // user clicks OK

		const result = await manager.handleToolCall(
			{ toolName: "write", input: { path: "/project/Module.bsl" } },
			acceptingCtx,
		);

		expect(result.block).toBe(false);
	});

	it("cycles permission levels and executes /permission command", async () => {
		const manager = new PermissionManager("auto-approve", "/project");
		const ctx = createMockContext();

		expect(manager.getLevel()).toBe("auto-approve");
		expect(manager.cycleLevel(ctx)).toBe("yolo");
		expect(manager.cycleLevel(ctx)).toBe("strict");
		expect(manager.cycleLevel(ctx)).toBe("auto-approve");

		let commandHandler: any;
		const mockPi = {
			registerCommand: vi.fn((_name, cmd) => {
				commandHandler = cmd.handler;
			}),
		} as unknown as ExtensionAPI;

		manager.register(mockPi);
		expect(commandHandler).toBeDefined();

		await commandHandler("strict", ctx as unknown as ExtensionCommandContext);
		expect(manager.getLevel()).toBe("strict");

		await commandHandler("yolo", ctx as unknown as ExtensionCommandContext);
		expect(manager.getLevel()).toBe("yolo");
	});

	it("forces strict mode when target path is outside projectRoot across various input keys", () => {
		const policy = new PermissionPolicy("auto-approve", "/project");

		// file_path outside projectRoot
		const filePathCheck = policy.checkToolCall("write", { file_path: "/opt/1cv8/test.bsl" });
		expect(filePathCheck.allowed).toBe(false);
		expect(filePathCheck.requiresUserConfirmation).toBe(true);
		expect(filePathCheck.reason).toContain("/opt/1cv8/test.bsl");

		// targetPath outside projectRoot
		const targetPathCheck = policy.checkToolCall("write", { targetPath: "/tmp/gen.xml" });
		expect(targetPathCheck.allowed).toBe(false);
		expect(targetPathCheck.requiresUserConfirmation).toBe(true);

		// outputPath outside projectRoot
		const outputPathCheck = policy.checkToolCall("write", { outputPath: "/tmp/out.xml" });
		expect(outputPathCheck.allowed).toBe(false);
		expect(outputPathCheck.requiresUserConfirmation).toBe(true);

		// cwd outside projectRoot for terminal commands
		const cwdCheck = policy.checkToolCall("bash", { command: "ls", cwd: "/tmp" });
		expect(cwdCheck.allowed).toBe(false);
		expect(cwdCheck.requiresUserConfirmation).toBe(true);

		// tilde expansion for ~/.local (incident E5)
		const tildeCheck = policy.checkToolCall("edit", {
			path: "~/.local/share/onescript/lib/v8find/src/Классы/Платформа1С.os",
		});
		expect(tildeCheck.allowed).toBe(false);
		expect(tildeCheck.requiresUserConfirmation).toBe(true);

		// relative path escaping project
		const relEscapeCheck = policy.checkToolCall("edit", { path: "../outside/Module.bsl" });
		expect(relEscapeCheck.allowed).toBe(false);
		expect(relEscapeCheck.requiresUserConfirmation).toBe(true);

		// 1c_vanessa with outside src requires confirmation even in auto-approve
		const vanessaOutsideCheck = policy.checkToolCall("1c_vanessa", {
			action: "load",
			src: "/opt/external-src",
		});
		expect(vanessaOutsideCheck.allowed).toBe(false);
		expect(vanessaOutsideCheck.requiresUserConfirmation).toBe(true);
	});

	it("supports confirmation via ctx.ui.askUser as well as ctx.ui.confirm", async () => {
		const manager = new PermissionManager("auto-approve", "/project");

		// Context with askUser instead of confirm
		const askUserAcceptCtx = {
			hasUI: true,
			ui: {
				askUser: vi.fn(async () => true),
			},
		} as unknown as ExtensionContext;

		const resultAllowed = await manager.handleToolCall(
			{ toolName: "write", input: { path: "/etc/passwd" } },
			askUserAcceptCtx,
		);
		expect(resultAllowed.block).toBe(false);
		expect((askUserAcceptCtx.ui as any).askUser).toHaveBeenCalled();

		const askUserDenyCtx = {
			hasUI: true,
			ui: {
				askUser: vi.fn(async () => false),
			},
		} as unknown as ExtensionContext;

		const resultDenied = await manager.handleToolCall(
			{ toolName: "write", input: { path: "/etc/passwd" } },
			askUserDenyCtx,
		);
		expect(resultDenied.block).toBe(true);
		expect(resultDenied.reason).toContain("действие не подтверждено пользователем");
	});

	it("blocks outside project writes when running headless without UI", async () => {
		const manager = new PermissionManager("auto-approve", "/project");
		const headlessCtx = { hasUI: false } as unknown as ExtensionContext;

		const result = await manager.handleToolCall({ toolName: "write", input: { path: "/tmp/foo.txt" } }, headlessCtx);
		expect(result.block).toBe(true);
		expect(result.reason).toContain("действие не подтверждено пользователем");
	});
});
