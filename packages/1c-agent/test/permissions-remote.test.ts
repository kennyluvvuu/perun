import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { PermissionPolicy, type RemoteConfirmFn } from "../src/permissions/policy.ts";
import { PermissionManager } from "../src/permissions/tools.ts";

describe("1C Permission Policy Remote Confirm & UI Race", () => {
	const projectRoot = "/project";

	it("1. Headless mode (hasUI: false): when remoteConfirm returns true, tool call is allowed (block: false)", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);
		const remoteMock: RemoteConfirmFn = vi.fn(async () => true);
		policy.setRemoteConfirm(remoteMock);

		const ctx = { hasUI: false } as unknown as ExtensionContext;
		const result = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		expect(result.block).toBe(false);
		expect(remoteMock).toHaveBeenCalledTimes(1);
		expect(remoteMock).toHaveBeenCalledWith(
			expect.stringContaining("[1C Безопасность]"),
			expect.any(String),
			expect.any(Object),
		);
	});

	it("2. Headless mode (hasUI: false): when remoteConfirm returns false, tool call is blocked (block: true)", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);
		const remoteMock: RemoteConfirmFn = vi.fn(async () => false);
		policy.setRemoteConfirm(remoteMock);

		const ctx = { hasUI: false } as unknown as ExtensionContext;
		const result = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("действие не подтверждено пользователем");
		expect(remoteMock).toHaveBeenCalledTimes(1);
	});

	it("3. Headless mode (hasUI: false): when remoteConfirm returns undefined (timeout), tool call is blocked", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);
		const remoteMock: RemoteConfirmFn = vi.fn(async () => undefined);
		policy.setRemoteConfirm(remoteMock);

		const ctx = { hasUI: false } as unknown as ExtensionContext;
		const result = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("действие не подтверждено пользователем");
		expect(remoteMock).toHaveBeenCalledTimes(1);
	});

	it("4. Headless mode (hasUI: false): ctx.ui.confirm is NOT called at all", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);
		const remoteMock: RemoteConfirmFn = vi.fn(async () => true);
		policy.setRemoteConfirm(remoteMock);

		const confirmMock = vi.fn(async () => false);
		const ctx = {
			hasUI: false,
			ui: {
				confirm: confirmMock,
			},
		} as unknown as ExtensionContext;

		const result = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		expect(result.block).toBe(false);
		expect(remoteMock).toHaveBeenCalledTimes(1);
		expect(confirmMock).not.toHaveBeenCalled();
	});

	it("5. Interactive mode (hasUI: true): when remote answers true first, local localAc.signal is aborted and tool call is allowed", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);
		let localSignal: AbortSignal | undefined;

		const confirmMock = vi.fn((_title: string, _msg: string, opts?: { signal?: AbortSignal }) => {
			localSignal = opts?.signal;
			return new Promise<boolean>(() => {});
		});

		policy.setRemoteConfirm(async () => true);

		const ctx = {
			hasUI: true,
			ui: { confirm: confirmMock },
		} as unknown as ExtensionContext;

		const result = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		expect(result.block).toBe(false);
		expect(confirmMock).toHaveBeenCalledTimes(1);
		expect(localSignal).toBeDefined();
		expect(localSignal?.aborted).toBe(true);
	});

	it("6. Interactive mode (hasUI: true): when remote answers false first, local localAc.signal is aborted and tool call is blocked", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);
		let localSignal: AbortSignal | undefined;

		const confirmMock = vi.fn((_title: string, _msg: string, opts?: { signal?: AbortSignal }) => {
			localSignal = opts?.signal;
			return new Promise<boolean>(() => {});
		});

		policy.setRemoteConfirm(async () => false);

		const ctx = {
			hasUI: true,
			ui: { confirm: confirmMock },
		} as unknown as ExtensionContext;

		const result = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		expect(result.block).toBe(true);
		expect(result.reason).toContain("действие не подтверждено пользователем");
		expect(confirmMock).toHaveBeenCalledTimes(1);
		expect(localSignal).toBeDefined();
		expect(localSignal?.aborted).toBe(true);
	});

	it("7. Interactive mode (hasUI: true): when local answers first, remote remoteAc.signal is aborted and tool call reflects local answer", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);

		// Case 7a: Local answers true
		let remoteSignal1: AbortSignal | undefined;
		policy.setRemoteConfirm((_title, _msg, signal) => {
			remoteSignal1 = signal;
			return new Promise<boolean | undefined>(() => {});
		});

		const confirmMock1 = vi.fn(async () => true);
		const ctx1 = {
			hasUI: true,
			ui: { confirm: confirmMock1 },
		} as unknown as ExtensionContext;

		const result1 = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx1);

		expect(result1.block).toBe(false);
		expect(remoteSignal1).toBeDefined();
		expect(remoteSignal1?.aborted).toBe(true);

		// Case 7b: Local answers false
		let remoteSignal2: AbortSignal | undefined;
		policy.setRemoteConfirm((_title, _msg, signal) => {
			remoteSignal2 = signal;
			return new Promise<boolean | undefined>(() => {});
		});

		const confirmMock2 = vi.fn(async () => false);
		const ctx2 = {
			hasUI: true,
			ui: { confirm: confirmMock2 },
		} as unknown as ExtensionContext;

		const result2 = await policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx2);

		expect(result2.block).toBe(true);
		expect(result2.reason).toContain("действие не подтверждено пользователем");
		expect(remoteSignal2).toBeDefined();
		expect(remoteSignal2?.aborted).toBe(true);
	});

	it("8. Interactive mode (hasUI: true): when remote returns undefined (timeout/cancelled), local UI stays open and waits for user", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);

		let resolveLocalUI!: (val: boolean) => void;
		let localSignal: AbortSignal | undefined;

		const confirmMock = vi.fn((_title: string, _msg: string, opts?: { signal?: AbortSignal }) => {
			localSignal = opts?.signal;
			return new Promise<boolean>((resolve) => {
				resolveLocalUI = resolve;
			});
		});

		let remoteCalled = false;
		policy.setRemoteConfirm(async () => {
			remoteCalled = true;
			return undefined;
		});

		const ctx = {
			hasUI: true,
			ui: { confirm: confirmMock },
		} as unknown as ExtensionContext;

		const promise = policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		await new Promise((r) => setTimeout(r, 20));

		expect(remoteCalled).toBe(true);
		expect(localSignal?.aborted).toBe(false);

		resolveLocalUI(true);
		const result = await promise;

		expect(result.block).toBe(false);
	});

	it("9. Parent ctx.signal aborts both local and remote", async () => {
		const policy = new PermissionPolicy("strict", projectRoot);
		const parentAc = new AbortController();

		let localSignal: AbortSignal | undefined;
		let remoteSignal: AbortSignal | undefined;

		const confirmMock = vi.fn((_title: string, _msg: string, opts?: { signal?: AbortSignal }) => {
			localSignal = opts?.signal;
			return new Promise<boolean>(() => {});
		});

		policy.setRemoteConfirm((_title, _msg, signal) => {
			remoteSignal = signal;
			return new Promise<boolean | undefined>(() => {});
		});

		const ctx = {
			hasUI: true,
			signal: parentAc.signal,
			ui: { confirm: confirmMock },
		} as unknown as ExtensionContext;

		const promise = policy.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		await new Promise((r) => setTimeout(r, 20));

		expect(localSignal).toBeDefined();
		expect(remoteSignal).toBeDefined();
		expect(localSignal?.aborted).toBe(false);
		expect(remoteSignal?.aborted).toBe(false);

		parentAc.abort();

		const result = await promise;
		expect(result.block).toBe(true);
		expect(localSignal?.aborted).toBe(true);
		expect(remoteSignal?.aborted).toBe(true);
	});

	it("delegates setRemoteConfirm through PermissionManager", async () => {
		const manager = new PermissionManager("strict", projectRoot);
		const remoteMock: RemoteConfirmFn = vi.fn(async () => true);
		manager.setRemoteConfirm(remoteMock);

		expect(manager.getRemoteConfirm()).toBe(remoteMock);

		const ctx = { hasUI: false } as unknown as ExtensionContext;
		const result = await manager.handleToolCall({ toolName: "write", input: { path: "/project/Module.bsl" } }, ctx);

		expect(result.block).toBe(false);
		expect(remoteMock).toHaveBeenCalledTimes(1);
	});
});
