import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { createInMemoryModelRegistry } from "./model-runtime-test-utils.ts";

describe("extension_request event", () => {
	let tempDir: string;
	let extensionsDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-request-test-"));
		extensionsDir = path.join(tempDir, "extensions");
		fs.mkdirSync(extensionsDir);
	});

	afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

	async function createRunner(...extensions: string[]) {
		for (let i = 0; i < extensions.length; i++) fs.writeFileSync(path.join(extensionsDir, `e${i}.ts`), extensions[i]);
		const result = await discoverAndLoadExtensions([], tempDir, tempDir);
		const sm = SessionManager.inMemory();
		const mr = await createInMemoryModelRegistry(AuthStorage.inMemory());
		return new ExtensionRunner(result.extensions, result.runtime, tempDir, sm, mr);
	}

	const request = (method: string, params: Record<string, unknown> = {}) => ({
		type: "extension_request" as const,
		method,
		params,
	});

	it("returns undefined when no extension owns the method", async () => {
		const runner = await createRunner(`export default p => p.on("extension_request", () => undefined);`);
		expect(await runner.emitExtensionRequest(request("docs.page"))).toBeUndefined();
	});

	it("returns the first non-undefined result", async () => {
		const runner = await createRunner(
			`export default p => p.on("extension_request", e => e.method === "a.ping" ? { pong: e.params.value } : undefined);`,
			`export default p => p.on("extension_request", async e => e.method.startsWith("b.") ? { owner: "b" } : undefined);`,
		);
		expect(await runner.emitExtensionRequest(request("a.ping", { value: 7 }))).toEqual({ pong: 7 });
		expect(await runner.emitExtensionRequest(request("b.any"))).toEqual({ owner: "b" });
	});

	it("propagates handler errors to the caller", async () => {
		const runner = await createRunner(
			`export default p => p.on("extension_request", async () => { throw new Error("not found"); });`,
		);
		await expect(runner.emitExtensionRequest(request("docs.page"))).rejects.toThrow("not found");
	});
});
