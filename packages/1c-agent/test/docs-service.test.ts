import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DocsService } from "../src/docs/index.ts";

const COMMON = "src/CommonModules/Остатки/Module.bsl";
const OBJECT = "src/Documents/Заказ/ObjectModule.bsl";
const FORM = "src/Documents/Заказ/Forms/ФормаДокумента/Module.bsl";
const FN = `${COMMON}#ПолучитьОстаток`;

const commonModule = (body: string, extra = "") => `// Работа с остатками.

// Возвращает остаток товара.
Функция ПолучитьОстаток(Номенклатура, Склад) Экспорт
	${body}
КонецФункции

Процедура СброситьКэш()
КонецПроцедуры
${extra}`;

function git(root: string, ...args: string[]): void {
	execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: root, stdio: "ignore" });
}

function write(root: string, file: string, content: string): void {
	fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
	fs.writeFileSync(path.join(root, file), content);
}

function commit(root: string, message: string): void {
	git(root, "add", "-A");
	git(root, "commit", "-q", "-m", message);
}

describe("docs: service over local git", () => {
	let tempDir: string;
	let root: string;
	let service: DocsService;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "perun-docs-test-"));
		root = path.join(tempDir, "project");
		fs.mkdirSync(root);
		git(root, "init", "-q");
		write(root, COMMON, commonModule("Возврат 1;"));
		write(root, OBJECT, "Процедура ОбработкаПроведения(Отказ, Режим)\nКонецПроцедуры\n");
		write(root, FORM, "&НаКлиенте\nПроцедура ПриОткрытии(Отказ)\nКонецПроцедуры\n");
		write(root, "README.md", "not bsl");
		commit(root, "init");
		service = new DocsService({ root, dbPath: path.join(tempDir, "docs.db"), checkIntervalMs: 0 });
	});

	afterEach(() => {
		service.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("indexes HEAD and builds the sidebar tree lazily", async () => {
		const report = await service.sync();
		expect(report).toMatchObject({ added: 3, changed: 0, removed: 0, upToDate: false });
		expect((await service.sync()).upToDate).toBe(true);
		expect(service.status()).toMatchObject({ source: "git", modules: 3, symbols: 4, documented: 0, outdated: 0 });

		const roots = service.tree("procedure", "");
		expect(roots.map((node) => `${node.type}:${node.label}:${node.count}`)).toEqual([
			"folder:Документы:2",
			"folder:Общие модули:1",
		]);
		const common = service.tree("procedure", "src/CommonModules");
		expect(common).toEqual([
			expect.objectContaining({ type: "module", label: "Остатки", id: COMMON, hasChildren: true }),
		]);
		expect(service.tree("procedure", COMMON).map((node) => node.label)).toEqual(["СброситьКэш"]);
		expect(service.tree("procedure", "src/Documents/Заказ").map((node) => `${node.type}:${node.label}`)).toEqual([
			"folder:Формы",
			"module:Модуль объекта",
		]);
		expect(service.tree("module", "src/Documents/Заказ/Forms").map((node) => node.label)).toEqual(["ФормаДокумента"]);
	});

	it("serves pages, searches names and notes, and saves notes", async () => {
		await service.sync();
		const page = service.page(FN.toLowerCase().replace("src/commonmodules/остатки/module.bsl", COMMON));
		expect(page).toMatchObject({ kind: "function", title: "ПолучитьОстаток", isExport: true, line: 4 });
		expect(page.comment).toBe("Возвращает остаток товара.");
		expect(page.module).toEqual({ id: COMMON, title: "ОбщийМодуль.Остатки" });
		expect(service.page(COMMON).members.map((member) => member.name)).toEqual(["ПолучитьОстаток", "СброситьКэш"]);

		expect(service.search("остаток", undefined, 10)[0]).toMatchObject({ id: FN, documented: false });
		expect(service.search("остаток", "procedure", 10)).toEqual([]);

		const saved = await service.saveNote(
			path.join(root, FN),
			{
				summary: "Считает свободный остаток с учетом резервов",
				cases: [{ title: "Склад не указан", text: "Берет все склады" }],
			},
			"agent",
		);
		expect(saved?.note).toMatchObject({ author: "agent", stale: false, cases: [{ title: "Склад не указан" }] });
		expect(service.search("резервов", undefined, 10).map((hit) => hit.id)).toEqual([FN]);
		expect(service.status().documented).toBe(1);
		await expect(service.saveNote(`${COMMON}#НетТакого`, { summary: "x" }, "user")).rejects.toThrow();
	});

	it("tracks new, changed and removed code and marks notes stale", async () => {
		await service.sync();
		await service.saveNote(FN, { summary: "Возвращает единицу" }, "agent");

		write(root, COMMON, commonModule("Возврат 2;", "\nПроцедура НоваяПроцедура()\nКонецПроцедуры\n"));
		fs.rmSync(path.join(root, FORM));
		commit(root, "change");
		expect(await service.sync()).toMatchObject({ added: 0, changed: 1, removed: 1 });

		expect(service.page(FN).note?.stale).toBe(true);
		expect(() => service.page(FORM)).toThrow();
		const outdated = service.outdated(10).map((item) => `${item.reason}:${item.title}`);
		expect(outdated).toEqual(expect.arrayContaining(["stale:ПолучитьОстаток", "new:НоваяПроцедура"]));
		expect(outdated).not.toContain(expect.stringContaining("СброситьКэш"));
	});

	it("accepts notes for uncommitted code and attaches them after commit", async () => {
		await service.sync();
		write(
			root,
			OBJECT,
			"Процедура ОбработкаПроведения(Отказ, Режим)\nКонецПроцедуры\n\nПроцедура Новая()\nКонецПроцедуры\n",
		);
		expect(await service.saveNote(`${OBJECT}#Новая`, { summary: "Новая процедура" }, "agent")).toBeUndefined();
		commit(root, "new");
		await service.sync();
		expect(service.page(`${OBJECT}#Новая`).note).toMatchObject({ summary: "Новая процедура", stale: false });
	});

	it("falls back to the working tree when the project is not a git repository", async () => {
		const plain = path.join(tempDir, "plain");
		write(plain, "src/CommonModules/Без/Module.bsl", "Процедура А()\nКонецПроцедуры\n");
		const worktree = new DocsService({ root: plain, dbPath: path.join(tempDir, "docs.db"), checkIntervalMs: 0 });
		await worktree.sync();
		expect(worktree.status()).toMatchObject({ source: "worktree", modules: 1, symbols: 1 });
		worktree.close();
	});
});
