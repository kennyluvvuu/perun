import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionRequestEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOnecAgentExtension } from "../src/index.ts";

const MODULE = "src/CommonModules/Цены/Module.bsl";

describe("docs: extension wiring", () => {
	let tempDir: string;
	let root: string;
	const tools = new Map<string, any>();
	const commands = new Map<string, any>();
	const handlers = new Map<string, Array<(...args: any[]) => any>>();

	const request = async (method: string, params: Record<string, unknown> = {}) => {
		const event: ExtensionRequestEvent = { type: "extension_request", method, params };
		for (const handler of handlers.get("extension_request") ?? []) {
			const result = await handler(event, {});
			if (result !== undefined) {
				return result;
			}
		}
		return undefined;
	};

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "perun-docs-ext-"));
		root = path.join(tempDir, "project");
		fs.mkdirSync(path.join(root, path.dirname(MODULE)), { recursive: true });
		fs.writeFileSync(path.join(root, MODULE), "Функция ЦенаТовара(Товар) Экспорт\n\tВозврат 0;\nКонецФункции\n");
		const git = (...args: string[]) =>
			execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root, stdio: "ignore" });
		git("init", "-q");
		git("add", "-A");
		git("commit", "-q", "-m", "init");
		tools.clear();
		commands.clear();
		handlers.clear();
	});

	afterEach(() => fs.rmSync(tempDir, { recursive: true, force: true }));

	function setup() {
		const pi = {
			registerTool: vi.fn((tool) => tools.set(tool.name, tool)),
			registerCommand: vi.fn((name, command) => commands.set(name, command)),
			registerShortcut: vi.fn(),
			on: vi.fn((event: string, handler: (...args: any[]) => any) => {
				handlers.set(event, [...(handlers.get(event) ?? []), handler]);
				return () => {};
			}),
			getActiveTools: vi.fn(() => []),
			setActiveTools: vi.fn(),
		} as unknown as ExtensionAPI;
		return createOnecAgentExtension({
			projectRoot: root,
			docsDbPath: path.join(tempDir, "docs.db"),
			memoryDbPath: path.join(tempDir, "memory.db"),
		})(pi);
	}

	it("serves docs.* methods and ignores foreign methods", async () => {
		const instance = setup();
		expect(await request("other.method")).toBeUndefined();

		const synced = await request("docs.sync");
		expect(synced.status).toMatchObject({ source: "git", modules: 1, symbols: 1 });
		const tree = await request("docs.tree", { section: "function" });
		expect(tree.items).toEqual([expect.objectContaining({ type: "folder", label: "Общие модули" })]);
		const common = await request("docs.tree", { section: "function", node: "src/CommonModules" });
		expect(common.items).toEqual([expect.objectContaining({ type: "module", label: "Цены", id: MODULE })]);
		const leaves = await request("docs.tree", { section: "function", node: MODULE });
		expect(leaves.items[0]).toMatchObject({ type: "symbol", label: "ЦенаТовара", docId: `${MODULE}#ЦенаТовара` });

		const saved = await request("docs.save", {
			id: `${MODULE}#ЦенаТовара`,
			summary: "Возвращает цену товара",
			details: "Берется из регистра цен.",
			cases: [
				{ title: "Нет цены", text: "Возвращает 0" },
				{ title: " ", text: "" },
			],
		});
		expect(saved.page.note).toMatchObject({ author: "user", cases: [{ title: "Нет цены", text: "Возвращает 0" }] });
		expect((await request("docs.search", { query: "регистра" })).hits[0].id).toBe(`${MODULE}#ЦенаТовара`);
		expect((await request("docs.remove", { id: `${MODULE}#ЦенаТовара` })).page.note).toBeUndefined();

		await expect(request("docs.page", { id: "src/нет.bsl" })).rejects.toThrow("Документация не найдена");
		await expect(request("docs.tree", { section: "class" })).rejects.toThrow("section");
		await expect(request("docs.unknown")).rejects.toThrow("Неизвестный метод");
		instance.docsService.close();
	});

	it("registers agent tools that work in read-only modes without confirmation", async () => {
		const instance = setup();
		expect([...tools.keys()]).toEqual(
			expect.arrayContaining(["1c_docs_search", "1c_docs_read", "1c_docs_write", "1c_docs_outdated"]),
		);
		expect(commands.has("docs")).toBe(true);

		instance.modeManager.setMode("explain");
		expect(instance.modeManager.checkToolCall("1c_docs_write").block).toBe(false);
		instance.permissionManager.setLevel("strict");
		expect(instance.permissionManager.checkToolCall("1c_docs_write", { id: MODULE }).allowed).toBe(true);

		await instance.docsService.sync();
		const write = await tools.get("1c_docs_write").execute("t1", { id: MODULE, summary: "Цены товаров" });
		expect(write.content[0].text).toContain("Описание сохранено");
		const read = await tools.get("1c_docs_read").execute("t2", { id: MODULE });
		expect(read.content[0].text).toContain("Цены товаров");
		instance.docsService.close();
	});
});
