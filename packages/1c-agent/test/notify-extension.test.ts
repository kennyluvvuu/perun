import type {
	AgentEndEvent,
	AgentSettledEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOnecAgentExtension, type OnecAgentExtensionOptions } from "../src/index.ts";

function setupExtension(options: OnecAgentExtensionOptions = {}) {
	const registeredTools = new Map<string, any>();
	const registeredCommands = new Map<string, any>();
	const eventHandlers = new Map<string, Array<(...args: any[]) => any>>();

	const mockPi = {
		registerTool: vi.fn((tool) => {
			registeredTools.set(tool.name, tool);
		}),
		registerCommand: vi.fn((name, cmd) => {
			registeredCommands.set(name, cmd);
		}),
		registerShortcut: vi.fn(),
		on: vi.fn((event, handler) => {
			const list = eventHandlers.get(event) ?? [];
			list.push(handler);
			eventHandlers.set(event, list);
			return () => {};
		}),
		getActiveTools: vi.fn(() => []),
		setActiveTools: vi.fn(),
	} as unknown as ExtensionAPI;

	const ctx = {
		hasUI: true,
		mode: "tui",
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
		eventHandlers,
		instance,
	};
}

describe("Perun Notify Extension Integration", () => {
	const originalEnv = process.env;

	beforeEach(() => {
		process.env = { ...originalEnv };
		delete process.env.PERUN_NOTIFY_URL;
		delete process.env.PERUN_NOTIFY_SECRET;
		delete process.env.PERUN_NOTIFY_SESSION;
	});

	afterEach(() => {
		process.env = originalEnv;
		vi.restoreAllMocks();
	});

	it("does not create notifyClient or wire remoteConfirm when env vars are missing", () => {
		const { instance, eventHandlers } = setupExtension();

		expect(instance.notifyClient).toBeUndefined();
		expect(instance.permissionManager.getPolicy().getRemoteConfirm()).toBeUndefined();

		const agentEndHandlers = eventHandlers.get("agent_end") ?? [];
		expect(agentEndHandlers.length).toBe(0);

		const agentSettledHandlers = eventHandlers.get("agent_settled") ?? [];
		expect(agentSettledHandlers.length).toBe(0);
	});

	it("initializes notifyClient, remoteConfirm, and hooks when PERUN_NOTIFY_URL and SECRET are set", async () => {
		process.env.PERUN_NOTIFY_URL = "http://127.0.0.1:4000/perun/events";
		process.env.PERUN_NOTIFY_SECRET = "secret-token-123";
		process.env.PERUN_NOTIFY_SESSION = "custom-session";

		const { instance, eventHandlers, ctx } = setupExtension();

		expect(instance.notifyClient).toBeDefined();
		expect(instance.permissionManager.getPolicy().getRemoteConfirm()).toBeDefined();

		const sessionStartHandler = eventHandlers.get("session_start")?.[0];
		expect(sessionStartHandler).toBeDefined();
		await sessionStartHandler!({ type: "session_start" } as SessionStartEvent, ctx);

		const notifySpy = vi.spyOn(instance.notifyClient!, "notify").mockImplementation(() => {});

		// 1. Verify agent_end sends only the last assistant message
		const agentEndHandler = eventHandlers.get("agent_end")?.[0];
		expect(agentEndHandler).toBeDefined();

		const agentEndEvent: AgentEndEvent = {
			type: "agent_end",
			messages: [
				{ role: "user", content: "Привет" } as any,
				{ role: "assistant", content: "Первый ответ" } as any,
				{ role: "tool", content: "Результат" } as any,
				{ role: "assistant", content: "Финальный ответ" } as any,
			],
		};

		agentEndHandler!(agentEndEvent, ctx);

		expect(notifySpy).toHaveBeenCalledWith({
			type: "agent_end",
			messages: [{ role: "assistant", content: "Финальный ответ" }],
		});

		// 2. Verify agent_end when no assistant message exists
		notifySpy.mockClear();
		agentEndHandler!({ type: "agent_end", messages: [{ role: "user", content: "Только юзер" } as any] }, ctx);
		expect(notifySpy).toHaveBeenCalledWith({
			type: "agent_end",
			messages: [],
		});

		// 3. Verify agent_settled sends aborted flag
		notifySpy.mockClear();
		const agentSettledHandler = eventHandlers.get("agent_settled")?.[0];
		expect(agentSettledHandler).toBeDefined();

		const agentSettledEvent: AgentSettledEvent = {
			type: "agent_settled",
			aborted: false,
		};
		agentSettledHandler!(agentSettledEvent, ctx);
		expect(notifySpy).toHaveBeenCalledWith({
			type: "agent_settled",
			aborted: false,
		});

		// 4. Verify session_shutdown flushes notifyClient
		const flushSpy = vi.spyOn(instance.notifyClient!, "flush").mockResolvedValue();
		const sessionShutdownHandler = eventHandlers.get("session_shutdown")?.[0];
		expect(sessionShutdownHandler).toBeDefined();

		await sessionShutdownHandler!();
		expect(flushSpy).toHaveBeenCalled();
	});

	it("routes error notifications to ctx.ui.notify in tui/rpc mode and stderr in print/json mode", async () => {
		process.env.PERUN_NOTIFY_URL = "http://127.0.0.1:4000/perun/events";
		process.env.PERUN_NOTIFY_SECRET = "secret-token-123";

		const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

		const { instance, eventHandlers, ctx } = setupExtension();

		// Trigger onError before session_start (activeCtx undefined) -> routes to stderr
		const notifyConfig = (instance.notifyClient as any).config;
		notifyConfig.onError("Network unreachable");
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[Perun] Network unreachable"));

		// Start session in tui mode -> routes to ctx.ui.notify
		const sessionStartHandler = eventHandlers.get("session_start")?.[0];
		await sessionStartHandler!({ type: "session_start" } as SessionStartEvent, ctx);

		notifyConfig.onError("Telegram bot timed out");
		expect(ctx.ui.notify).toHaveBeenCalledWith("Telegram bot timed out", "warning");

		// Change mode to print -> routes to stderr
		(ctx as any).mode = "print";
		stderrSpy.mockClear();
		notifyConfig.onError("Delivery failed");
		expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining("[Perun] Delivery failed"));
	});
});
