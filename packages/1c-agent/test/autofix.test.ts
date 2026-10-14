import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePatches, generateUnifiedDiff } from "../src/autofix/patcher.ts";
import { analyzeCodeForItsRules, parseBslAnalyzerJsonOutput } from "../src/autofix/rules.ts";
import { registerAutofixTools } from "../src/autofix/tools.ts";

describe("ITS Standards Auto-Fixer", () => {
	let tempDir: string;
	let testFile: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "1c-autofix-test-"));
		testFile = path.join(tempDir, "BadModule.bsl");
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("detects QueryInLoop violation", () => {
		const code = `
Процедура Обработать()
	Для Каждого Стр Из ТаблицаТоваров Цикл
		Запрос = Новый Запрос;
		Запрос.Текст = "ВЫБРАТЬ 1";
		Запрос.Выполнить();
	КонецЦикла;
КонецПроцедуры
`;
		const violations = analyzeCodeForItsRules("Module.bsl", code);
		const queryInLoop = violations.find((v) => v.ruleId === "QueryInLoop");

		expect(queryInLoop).toBeDefined();
		expect(queryInLoop?.severity).toBe("error");
		expect(queryInLoop?.canAutoFix).toBe(false);
		expect(queryInLoop?.message).toContain("внутри цикла");
	});

	it("detects and auto-fixes EmptyExcept block", () => {
		const code = `
Процедура ВыполнитьДействие()
	Попытка
		ПодключитьВнешнююКомпоненту();
	Исключение
	КонецПопытки;
КонецПроцедуры
`;
		const violations = analyzeCodeForItsRules("Module.bsl", code);
		const emptyExcept = violations.find((v) => v.ruleId === "EmptyExcept");

		expect(emptyExcept).toBeDefined();
		expect(emptyExcept?.canAutoFix).toBe(true);

		const { fixedContent, appliedCount } = generatePatches("Module.bsl", code, violations);
		expect(appliedCount).toBe(1);
		expect(fixedContent).toContain("ЗаписьЖурналаРегистрации");
	});

	it("detects and removes UnusedVariable in single and multi-variable declarations with Cyrillic names", () => {
		const code = `
Процедура Расчет()
	Перем МояПеременная, НеиспользуемыйСчетчик;
	МояПеременная = 100;
	Возврат МояПеременная;
КонецПроцедуры
`;
		const violations = analyzeCodeForItsRules("Module.bsl", code);
		expect(violations.some((v) => v.message.includes("МояПеременная"))).toBe(false);

		const unusedVar = violations.find((v) => v.ruleId === "UnusedVariable");
		expect(unusedVar).toBeDefined();
		expect(unusedVar?.message).toContain("НеиспользуемыйСчетчик");

		const { fixedContent, appliedCount } = generatePatches("Module.bsl", code, violations);
		expect(appliedCount).toBe(1);
		expect(fixedContent).toContain("Перем МояПеременная;");
		expect(fixedContent).not.toContain("НеиспользуемыйСчетчик");
	});

	it("detects missing BSLDoc and inserts documentation stub before directives", () => {
		const code = `
&НаСервере
Процедура ЗагрузитьДанныеИзФайла(ПутьКФайлу) Экспорт
	ПрочитатьФайл(ПутьКФайлу);
КонецПроцедуры
`;
		const violations = analyzeCodeForItsRules("Module.bsl", code);
		const missingDoc = violations.find((v) => v.ruleId === "MissingBSLDoc");

		expect(missingDoc).toBeDefined();
		expect(missingDoc?.canAutoFix).toBe(true);

		const { fixedContent, appliedCount } = generatePatches("Module.bsl", code, violations);
		expect(appliedCount).toBe(1);
		expect(fixedContent).toContain("// Описание:");
		expect(fixedContent).toContain("// Параметры:");
		// Comment must precede &НаСервере
		const commentIndex = fixedContent.indexOf("// Описание:");
		const directiveIndex = fixedContent.indexOf("&НаСервере");
		expect(commentIndex).toBeLessThan(directiveIndex);
	});

	it("generates a clean unified diff", () => {
		const orig = "Строка 1\nСтрока 2";
		const mod = "Строка 1\nСтрока 2 изменена";
		const diff = generateUnifiedDiff("test.bsl", orig, mod);

		expect(diff).toContain("--- a/test.bsl");
		expect(diff).toContain("+++ b/test.bsl");
		expect(diff).toContain("-Строка 2");
		expect(diff).toContain("+Строка 2 изменена");
	});

	it("parses external bsl-analyzer analyze JSON output", () => {
		const json = JSON.stringify([
			{
				file: "Common.bsl",
				line: 15,
				column: 5,
				code: "EmptyExcept",
				message: "Пустой блок исключения",
				severity: "warning",
			},
		]);

		const parsed = parseBslAnalyzerJsonOutput(json, "Default.bsl");
		expect(parsed).toHaveLength(1);
		expect(parsed[0].ruleId).toBe("EmptyExcept");
		expect(parsed[0].line).toBe(15);
		expect(parsed[0].canAutoFix).toBe(true);
	});

	it("detects Cyrillic ServerModalCall in server context", () => {
		const code = `
&НаСервере
Процедура ОбработатьДанныеСервер()
	Предупреждение("Операция не может быть выполнена!");
	Вопрос("Продолжить выполнение?", РежимДиалогаВопрос.ДаНет);
КонецПроцедуры
`;
		const violations = analyzeCodeForItsRules("Module.bsl", code);
		const modalCalls = violations.filter((v) => v.ruleId === "ServerModalCall");

		expect(modalCalls).toHaveLength(2);
		expect(modalCalls[0].message).toContain("Предупреждение");
		expect(modalCalls[1].message).toContain("Вопрос");
	});

	it("executes bsl_fix_standards tool with dryRun and auto-apply", async () => {
		const initialCode = `
Процедура Тест()
	Попытка
		Деление = 1 / 0;
	Исключение
	КонецПопытки;
КонецПроцедуры
`;
		await fs.promises.writeFile(testFile, initialCode, "utf8");

		let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
		const mockPi = {
			registerTool: vi.fn((tool) => {
				registeredTool = tool;
			}),
		} as unknown as ExtensionAPI;

		registerAutofixTools(mockPi);
		expect(registeredTool).toBeDefined();
		if (!registeredTool) throw new Error("tool not registered");

		// 1. Dry-run
		const dryResult = await registeredTool.execute(
			"call_1",
			{ target: testFile, dryRun: true },
			undefined,
			undefined,
			{} as ExtensionToolContext,
		);

		const dryDetails = dryResult.details as { appliedFixes?: number };
		expect(dryDetails.appliedFixes).toBe(1);
		const dryText = dryResult.content[0];
		if (dryText.type !== "text") throw new Error("expected text content");
		expect(dryText.text).toContain("сгенерировано исправлений (dry-run)");
		// File should not be modified
		const contentAfterDry = await fs.promises.readFile(testFile, "utf8");
		expect(contentAfterDry).toBe(initialCode);

		// 2. Real apply
		const applyResult = await registeredTool.execute(
			"call_2",
			{ target: testFile, dryRun: false },
			undefined,
			undefined,
			{} as ExtensionToolContext,
		);

		const applyDetails = applyResult.details as { appliedFixes?: number };
		expect(applyDetails.appliedFixes).toBe(1);
		const contentAfterApply = await fs.promises.readFile(testFile, "utf8");
		expect(contentAfterApply).toContain("ЗаписьЖурналаРегистрации");
	});
});
