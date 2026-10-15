import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDocsForDiff } from "../src/git/docgen.ts";
import * as gitRunner from "../src/git/git-runner.ts";

vi.mock("../src/git/git-runner.ts", () => ({
	getChangedFiles: vi.fn(),
}));

describe("1C DocGen - generateDocsForDiff", () => {
	let tempDir: string;

	beforeEach(async () => {
		tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "docgen-test-"));
	});

	afterEach(async () => {
		await fs.rm(tempDir, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	it("returns empty result when no changed .bsl files are found", async () => {
		vi.mocked(gitRunner.getChangedFiles).mockResolvedValue([
			{ path: "src/readme.md", status: "M" },
			{ path: "src/config.xml", status: "A" },
		]);

		const result = await generateDocsForDiff("HEAD", undefined, tempDir, false);

		expect(result.totalFiles).toBe(0);
		expect(result.totalMethods).toBe(0);
		expect(result.updatedMethods).toBe(0);
		expect(result.files).toHaveLength(0);
	});

	it("filters by filePathFilter and ignores deleted files", async () => {
		vi.mocked(gitRunner.getChangedFiles).mockResolvedValue([
			{ path: "src/ModuleA.bsl", status: "M" },
			{ path: "src/ModuleB.bsl", status: "D" },
			{ path: "other/ModuleC.bsl", status: "M" },
		]);

		const moduleAPath = path.join(tempDir, "src/ModuleA.bsl");
		await fs.mkdir(path.dirname(moduleAPath), { recursive: true });
		await fs.writeFile(moduleAPath, "Процедура Тест()\nКонецПроцедуры\n", "utf-8");

		const result = await generateDocsForDiff("HEAD", "ModuleA", tempDir, false);

		expect(result.totalFiles).toBe(1);
		expect(result.files[0].filePath).toBe("src/ModuleA.bsl");
	});

	it("generates patches without writing to disk when applyChanges is false", async () => {
		const relPath = "src/Documents/Order/ManagerModule.bsl";
		const fullPath = path.join(tempDir, relPath);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });

		const originalCode = [
			"&НаСервере",
			"Процедура ОбработкаПроведения(Отказ, РежимПроведения)",
			"\t// Проведение документа",
			"КонецПроцедуры",
			"",
			"Функция ПолучитьСумму(ДокументСсылка)",
			"\tВозврат 100;",
			"КонецФункции",
		].join("\n");

		await fs.writeFile(fullPath, originalCode, "utf-8");

		vi.mocked(gitRunner.getChangedFiles).mockResolvedValue([{ path: relPath, status: "M" }]);

		const result = await generateDocsForDiff("HEAD", undefined, tempDir, false);

		expect(result.totalFiles).toBe(1);
		expect(result.totalMethods).toBe(2);
		expect(result.updatedMethods).toBe(2);

		const fileSummary = result.files[0];
		expect(fileSummary.documentedMethods).toBe(0);
		expect(fileSummary.patch).toBeDefined();
		expect(fileSummary.patch).toContain("+++ b/src/Documents/Order/ManagerModule.bsl");
		expect(fileSummary.patch).toContain("+// Обработчик события ОбработкаПроведения.");
		expect(fileSummary.patch).toContain("+//   Отказ - Булево - Признак отказа");
		expect(fileSummary.patch).toContain("+// Возвращаемое значение:");

		// Verify file on disk remained unmodified
		const diskCode = await fs.readFile(fullPath, "utf-8");
		expect(diskCode).toBe(originalCode);
	});

	it("applies changes directly to disk when applyChanges is true", async () => {
		const relPath = "src/CommonModules/Utils.bsl";
		const fullPath = path.join(tempDir, relPath);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });

		const originalCode = ["Функция ПроверитьЗаполнение(Структура)", "\tВозврат Истина;", "КонецФункции"].join("\n");

		await fs.writeFile(fullPath, originalCode, "utf-8");

		vi.mocked(gitRunner.getChangedFiles).mockResolvedValue([{ path: relPath, status: "M" }]);

		const result = await generateDocsForDiff("HEAD", undefined, tempDir, true);

		expect(result.totalFiles).toBe(1);
		expect(result.updatedMethods).toBe(1);

		const fileSummary = result.files[0];
		expect(fileSummary.patch).toBeUndefined();

		// Verify disk file was updated
		const diskCode = await fs.readFile(fullPath, "utf-8");
		expect(diskCode).toContain("// Проверяет");
		expect(diskCode).toContain("// Параметры:");
		expect(diskCode).toContain("//   Структура - Структура - ");
		expect(diskCode).toContain("// Возвращаемое значение:");
		expect(diskCode).toContain("Функция ПроверитьЗаполнение");
	});

	it("skips methods that already have complete BSLDoc", async () => {
		const relPath = "src/CommonModules/Math.bsl";
		const fullPath = path.join(tempDir, relPath);
		await fs.mkdir(path.dirname(fullPath), { recursive: true });

		const completeCode = [
			"// Вычисляет факториал числа.",
			"//",
			"// Параметры:",
			"//   Число - Число - Входное число",
			"//",
			"// Возвращаемое значение:",
			"//   Число - Факториал",
			"Функция Факториал(Число)",
			"\tВозврат 1;",
			"КонецФункции",
		].join("\n");

		await fs.writeFile(fullPath, completeCode, "utf-8");

		vi.mocked(gitRunner.getChangedFiles).mockResolvedValue([{ path: relPath, status: "M" }]);

		const result = await generateDocsForDiff("HEAD", undefined, tempDir, true);

		expect(result.totalFiles).toBe(1);
		expect(result.totalMethods).toBe(1);
		expect(result.updatedMethods).toBe(0);
		expect(result.files[0].documentedMethods).toBe(1);
		expect(result.files[0].patch).toBeUndefined();

		const diskCode = await fs.readFile(fullPath, "utf-8");
		expect(diskCode).toBe(completeCode);
	});
});
