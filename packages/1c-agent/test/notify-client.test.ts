import { describe, expect, it, vi } from "vitest";
import { PerunNotifyClient } from "../src/notify/client.ts";
import type {
	AgentEndNotifyEvent,
	AgentSettledNotifyEvent,
	ExtensionUIConfirmRequest,
	ExtensionUIConfirmResponse,
} from "../src/notify/types.ts";

describe("PerunNotifyClient", () => {
	describe("askConfirm", () => {
		it("sends correct URL query params, headers, and UUID payload", async () => {
			let capturedUrl: string | undefined;
			let capturedInit: RequestInit | undefined;

			const mockFetch: typeof fetch = async (input, init) => {
				capturedUrl = String(input);
				capturedInit = init;
				const requestPayload = JSON.parse(String(init?.body)) as ExtensionUIConfirmRequest;
				const responsePayload: ExtensionUIConfirmResponse = {
					type: "extension_ui_response",
					id: requestPayload.id,
					confirmed: true,
				};
				return new Response(JSON.stringify(responsePayload), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			};

			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				session: "session-xyz-123",
				fetchFn: mockFetch,
			});

			const result = await client.askConfirm("Apply Changes", "Do you want to proceed?");
			expect(result).toBe(true);

			expect(capturedUrl).toBe("https://notify.example.com/events?session=session-xyz-123");
			expect(capturedInit?.method).toBe("POST");
			const headers = capturedInit?.headers as Record<string, string>;
			expect(headers.Authorization).toBe("Bearer perun-secret-key");
			expect(headers["Content-Type"]).toBe("application/json");

			const body = JSON.parse(String(capturedInit?.body)) as ExtensionUIConfirmRequest;
			expect(body.type).toBe("extension_ui_request");
			expect(body.method).toBe("confirm");
			expect(body.title).toBe("Apply Changes");
			expect(body.message).toBe("Do you want to proceed?");
			expect(typeof body.id).toBe("string");
			expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
		});

		it("does not include session param when session is omitted", async () => {
			let capturedUrl: string | undefined;

			const mockFetch: typeof fetch = async (input, init) => {
				capturedUrl = String(input);
				const requestPayload = JSON.parse(String(init?.body)) as ExtensionUIConfirmRequest;
				return new Response(
					JSON.stringify({
						type: "extension_ui_response",
						id: requestPayload.id,
						confirmed: true,
					}),
					{ status: 200 },
				);
			};

			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: mockFetch,
			});

			await client.askConfirm("Title", "Message");
			expect(capturedUrl).toBe("https://notify.example.com/events");
		});

		it("returns true when confirmed: true, false when confirmed: false", async () => {
			let returnConfirmed = true;
			const mockFetch: typeof fetch = async (_input, init) => {
				const requestPayload = JSON.parse(String(init?.body)) as ExtensionUIConfirmRequest;
				const responsePayload: ExtensionUIConfirmResponse = {
					type: "extension_ui_response",
					id: requestPayload.id,
					confirmed: returnConfirmed,
				};
				return new Response(JSON.stringify(responsePayload), { status: 200 });
			};

			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: mockFetch,
			});

			returnConfirmed = true;
			const resultTrue = await client.askConfirm("Title", "Confirm this?");
			expect(resultTrue).toBe(true);

			returnConfirmed = false;
			const resultFalse = await client.askConfirm("Title", "Confirm this?");
			expect(resultFalse).toBe(false);
		});

		it("returns undefined when cancelled: true", async () => {
			const mockFetch: typeof fetch = async (_input, init) => {
				const requestPayload = JSON.parse(String(init?.body)) as ExtensionUIConfirmRequest;
				const responsePayload: ExtensionUIConfirmResponse = {
					type: "extension_ui_response",
					id: requestPayload.id,
					cancelled: true,
				};
				return new Response(JSON.stringify(responsePayload), { status: 200 });
			};

			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: mockFetch,
			});

			const result = await client.askConfirm("Title", "Confirm this?");
			expect(result).toBeUndefined();
		});

		it("external AbortSignal aborts the request and returns undefined without triggering onError", async () => {
			const onError = vi.fn();

			// Pre-aborted signal
			const preAbortedController = new AbortController();
			preAbortedController.abort();

			const mockFetch = vi.fn<typeof fetch>();
			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: mockFetch,
				onError,
			});

			const preResult = await client.askConfirm("Title", "Message", preAbortedController.signal);
			expect(preResult).toBeUndefined();
			expect(mockFetch).not.toHaveBeenCalled();
			expect(onError).not.toHaveBeenCalled();

			// In-flight abort
			const inFlightController = new AbortController();
			const slowFetch: typeof fetch = async (_input, init) => {
				return new Promise<Response>((_resolve, reject) => {
					if (init?.signal) {
						init.signal.addEventListener("abort", () => {
							reject(init.signal?.reason ?? new Error("Aborted"));
						});
					}
				});
			};

			const slowClient = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: slowFetch,
				onError,
			});

			const confirmPromise = slowClient.askConfirm("Title", "Message", inFlightController.signal);
			inFlightController.abort();

			const inflightResult = await confirmPromise;
			expect(inflightResult).toBeUndefined();
			expect(onError).not.toHaveBeenCalled();
		});

		it("network error or 502 status returns undefined and triggers onError", async () => {
			const onError = vi.fn();

			// Network error
			const networkFailFetch: typeof fetch = async () => {
				throw new Error("Connection refused");
			};

			const clientWithNetworkError = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: networkFailFetch,
				onError,
			});

			const networkResult = await clientWithNetworkError.askConfirm("Title", "Message");
			expect(networkResult).toBeUndefined();
			expect(onError).toHaveBeenCalledWith("Confirmation request failed", expect.any(Error));

			onError.mockClear();

			// 502 Bad Gateway
			const http502Fetch: typeof fetch = async () => {
				return new Response("Bad Gateway", { status: 502, statusText: "Bad Gateway" });
			};

			const clientWith502 = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: http502Fetch,
				onError,
			});

			const httpResult = await clientWith502.askConfirm("Title", "Message");
			expect(httpResult).toBeUndefined();
			expect(onError).toHaveBeenCalledWith(expect.stringContaining("502"), undefined);
		});
	});

	describe("notify", () => {
		it("strictly sequential in-order execution (agent_end is dispatched and received before agent_settled)", async () => {
			const dispatchLog: string[] = [];
			const completeLog: string[] = [];

			const mockFetch: typeof fetch = async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as { type: string };
				dispatchLog.push(body.type);

				// Artificially delay agent_end to ensure agent_settled waits
				if (body.type === "agent_end") {
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				completeLog.push(body.type);
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			};

			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: mockFetch,
			});

			const endEvent: AgentEndNotifyEvent = {
				type: "agent_end",
				messages: [{ role: "assistant", content: "Completed work" }],
			};
			const settledEvent: AgentSettledNotifyEvent = {
				type: "agent_settled",
				aborted: false,
			};

			client.notify(endEvent);
			client.notify(settledEvent);

			await client.flush();

			expect(dispatchLog).toEqual(["agent_end", "agent_settled"]);
			expect(completeLog).toEqual(["agent_end", "agent_settled"]);
		});

		it("error in one event does not stop the queue, calls onError", async () => {
			const onError = vi.fn();
			const processed: string[] = [];

			const mockFetch: typeof fetch = async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as { type: string };
				if (body.type === "agent_end") {
					throw new Error("Temporary network glitch");
				}
				processed.push(body.type);
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			};

			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: mockFetch,
				onError,
			});

			client.notify({
				type: "agent_end",
				messages: [],
			});
			client.notify({
				type: "agent_settled",
				aborted: false,
			});

			await client.flush();

			expect(onError).toHaveBeenCalledWith("Notify request failed", expect.any(Error));
			expect(processed).toEqual(["agent_settled"]);
		});

		it("flush properly waits for all queued events to complete", async () => {
			const settled: number[] = [];

			const mockFetch: typeof fetch = async (_input, init) => {
				const body = JSON.parse(String(init?.body)) as { aborted: boolean; index: number };
				await new Promise((resolve) => setTimeout(resolve, 10));
				settled.push(body.index);
				return new Response(JSON.stringify({ ok: true }), { status: 200 });
			};

			const client = new PerunNotifyClient({
				url: "https://notify.example.com/events",
				secret: "perun-secret-key",
				fetchFn: mockFetch,
			});

			// Flush on empty queue should resolve immediately
			await expect(client.flush()).resolves.toBeUndefined();

			client.notify({
				type: "agent_settled",
				aborted: false,
				index: 1,
			} as AgentSettledNotifyEvent & { index: number });
			client.notify({
				type: "agent_settled",
				aborted: false,
				index: 2,
			} as AgentSettledNotifyEvent & { index: number });
			client.notify({
				type: "agent_settled",
				aborted: false,
				index: 3,
			} as AgentSettledNotifyEvent & { index: number });

			await client.flush();

			expect(settled).toEqual([1, 2, 3]);
		});
	});
});
