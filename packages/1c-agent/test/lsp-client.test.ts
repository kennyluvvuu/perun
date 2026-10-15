import { describe, expect, it, vi } from "vitest";
import { BslLspClient } from "../src/lsp/client.ts";
import * as toolchainResolver from "../src/toolchain/resolver.ts";
import type { LspDiagnostic } from "../src/types.ts";

describe("BslLspClient", () => {
	it("preserves explicitly provided executablePath in options", () => {
		const client = new BslLspClient({ executablePath: "/custom/bsl-analyzer" });
		expect(client.getExecutablePath()).toBe("/custom/bsl-analyzer");
	});

	it("returns false from start() when executablePath cannot be resolved", async () => {
		const client = new BslLspClient({ projectPath: "/project" });
		const resolverSpy = vi.spyOn(toolchainResolver, "resolveBslAnalyzerPath").mockReturnValue(undefined);

		try {
			const started = await client.start();
			expect(started).toBe(false);
			expect(client.isRunning()).toBe(false);
		} finally {
			resolverSpy.mockRestore();
		}
	});

	it("lazily resolves executablePath when start() is called", async () => {
		const client = new BslLspClient();
		expect(client.getExecutablePath()).toBeUndefined();

		const resolverSpy = vi
			.spyOn(toolchainResolver, "resolveBslAnalyzerPath")
			.mockReturnValue("/mock/bin/bsl-analyzer");

		try {
			const started = await client.start();
			expect(client.getExecutablePath()).toBe("/mock/bin/bsl-analyzer");
			expect(started).toBe(false);
		} finally {
			resolverSpy.mockRestore();
		}
	});
	it("converts between file paths and file:// URIs correctly", () => {
		const client = new BslLspClient({ projectPath: "/project/src" });

		const uri = client.filePathToUri("/project/src/Documents/Order/Module.bsl");
		expect(uri).toBe("file:///project/src/Documents/Order/Module.bsl");

		const backToPath = client.uriToFilePath(uri);
		expect(backToPath).toBe("/project/src/Documents/Order/Module.bsl");
	});

	it("processes and caches textDocument/publishDiagnostics notifications", () => {
		const client = new BslLspClient({ projectPath: "/project/src" });
		const fileUri = "file:///project/src/Module.bsl";

		const sampleDiagnostics: LspDiagnostic[] = [
			{
				range: {
					start: { line: 10, character: 4 },
					end: { line: 10, character: 25 },
				},
				severity: 1,
				code: "QueryInLoop",
				message: "Запрос в цикле",
			},
			{
				range: {
					start: { line: 20, character: 1 },
					end: { line: 20, character: 10 },
				},
				severity: 2,
				code: "UnusedVariable",
				message: "Неиспользуемая переменная",
			},
		];

		// Simulate incoming LSP notification
		client.handleMessage({
			jsonrpc: "2.0",
			method: "textDocument/publishDiagnostics",
			params: {
				uri: fileUri,
				diagnostics: sampleDiagnostics,
			},
		});

		const cached = client.getDiagnostics("/project/src/Module.bsl");
		expect(cached).toHaveLength(2);
		expect(cached[0].code).toBe("QueryInLoop");
		expect(cached[1].code).toBe("UnusedVariable");
	});

	it("resolves pending request on JSON-RPC response", async () => {
		const client = new BslLspClient();

		// Simulate request / response handling via internal handleMessage
		let resolvedResult: unknown;
		const dummyPromise = new Promise((resolve, reject) => {
			(client as unknown as { pendingRequests: Map<string | number, unknown> }).pendingRequests.set(100, {
				resolve: (res: unknown) => {
					resolvedResult = res;
					resolve(res);
				},
				reject,
				timer: setTimeout(() => {}, 10000),
			});
		});

		client.handleMessage({
			jsonrpc: "2.0",
			id: 100,
			result: { success: true, symbolsCount: 42 },
		});

		await dummyPromise;
		expect(resolvedResult).toEqual({ success: true, symbolsCount: 42 });
	});

	it("resolves waitForDiagnostics immediately when diagnostics arrive", async () => {
		const client = new BslLspClient({ projectPath: "/project" });
		const filePath = "/project/CommonModule.bsl";

		const waitPromise = client.waitForDiagnostics(filePath, 1000);

		// Publish diagnostics while waiter is listening
		client.handleMessage({
			jsonrpc: "2.0",
			method: "textDocument/publishDiagnostics",
			params: {
				uri: "file:///project/CommonModule.bsl",
				diagnostics: [
					{
						range: { start: { line: 1, character: 1 }, end: { line: 1, character: 5 } },
						severity: 2,
						message: "Тестовое предупреждение",
					},
				],
			},
		});

		const result = await waitPromise;
		expect(result).toHaveLength(1);
		expect(result[0].message).toBe("Тестовое предупреждение");
	});

	it("times out gracefully in waitForDiagnostics returning current cached state", async () => {
		const client = new BslLspClient({ projectPath: "/project" });
		const filePath = "/project/Empty.bsl";

		// Wait with 50ms timeout without publishing
		const result = await client.waitForDiagnostics(filePath, 50);
		expect(result).toEqual([]);
	});
});
