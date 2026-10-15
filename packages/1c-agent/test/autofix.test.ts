import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generatePatches, generateUnifiedDiff } from "../src/autofix/patcher.ts";
import {
	analyzeCodeForItsRules,
	isRuleAutoFixable,
	matchesRuleId,
	normalizeRuleId,
	parseBslAnalyzerJsonOutput,
	parseVirtualTableArgs,
	RULE_ALIASES,
	VIRTUAL_TABLE_PARAM_LIMITS,
} from "../src/autofix/rules.ts";
import { registerAutofixTools } from "../src/autofix/tools.ts";
import type { StandardFixResult } from "../src/types.ts";

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

	describe("Rule Aliases & bsl-analyzer synchronization (Defect D3)", () => {
		it("exports RULE_ALIASES mapping between bsl-analyzer and internal ITS rule codes", () => {
			expect(RULE_ALIASES.CreateQueryInCycle).toBe("QueryInLoop");
			expect(RULE_ALIASES.QueryInLoop).toBe("CreateQueryInCycle");
			expect(RULE_ALIASES.MissingCodeTryCatchEx).toBe("EmptyExcept");
			expect(RULE_ALIASES.EmptyExcept).toBe("MissingCodeTryCatchEx");
			expect(RULE_ALIASES.UnusedLocalVariable).toBe("UnusedVariable");
			expect(RULE_ALIASES.UnusedVariable).toBe("UnusedLocalVariable");
			expect(RULE_ALIASES.MissingBSLDocComments).toBe("MissingBSLDoc");
			expect(RULE_ALIASES.MissingBSLDocMethod).toBe("MissingBSLDoc");
		});

		it("normalizes canonical and alias rule IDs consistently via normalizeRuleId", () => {
			expect(normalizeRuleId("CreateQueryInCycle")).toBe("QueryInLoop");
			expect(normalizeRuleId("QueryInLoop")).toBe("QueryInLoop");
			expect(normalizeRuleId("MissingCodeTryCatchEx")).toBe("EmptyExcept");
			expect(normalizeRuleId("EmptyExcept")).toBe("EmptyExcept");
			expect(normalizeRuleId("UnusedLocalVariable")).toBe("UnusedVariable");
			expect(normalizeRuleId("UnusedVariable")).toBe("UnusedVariable");
			expect(normalizeRuleId("MissingBSLDocComments")).toBe("MissingBSLDoc");
			expect(normalizeRuleId("MissingBSLDocMethod")).toBe("MissingBSLDoc");
			expect(normalizeRuleId("MissingBSLDoc")).toBe("MissingBSLDoc");
			expect(normalizeRuleId("UnknownCustomRule")).toBe("UnknownCustomRule");
		});

		it("matches rule IDs bidirectionally with aliases via matchesRuleId", () => {
			// CreateQueryInCycle <-> QueryInLoop
			expect(matchesRuleId("CreateQueryInCycle", "QueryInLoop")).toBe(true);
			expect(matchesRuleId("QueryInLoop", "CreateQueryInCycle")).toBe(true);

			// MissingCodeTryCatchEx <-> EmptyExcept
			expect(matchesRuleId("MissingCodeTryCatchEx", "EmptyExcept")).toBe(true);
			expect(matchesRuleId("EmptyExcept", "MissingCodeTryCatchEx")).toBe(true);

			// UnusedLocalVariable <-> UnusedVariable
			expect(matchesRuleId("UnusedLocalVariable", "UnusedVariable")).toBe(true);
			expect(matchesRuleId("UnusedVariable", "UnusedLocalVariable")).toBe(true);

			// MissingBSLDocComments / MissingBSLDocMethod <-> MissingBSLDoc
			expect(matchesRuleId("MissingBSLDocComments", "MissingBSLDoc")).toBe(true);
			expect(matchesRuleId("MissingBSLDoc", "MissingBSLDocComments")).toBe(true);
			expect(matchesRuleId("MissingBSLDocMethod", "MissingBSLDoc")).toBe(true);
			expect(matchesRuleId("MissingBSLDoc", "MissingBSLDocMethod")).toBe(true);
			expect(matchesRuleId("MissingBSLDocComments", "MissingBSLDocMethod")).toBe(true);

			// Non-matching pairs
			expect(matchesRuleId("CreateQueryInCycle", "EmptyExcept")).toBe(false);
			expect(matchesRuleId("QueryInLoop", "MissingCodeTryCatchEx")).toBe(false);
			expect(matchesRuleId("UnusedVariable", "MissingBSLDoc")).toBe(false);
		});

		it("isRuleAutoFixable returns true for both canonical bsl-analyzer codes and their aliases", () => {
			// Auto-fixable canonical bsl-analyzer codes
			expect(isRuleAutoFixable("MissingCodeTryCatchEx")).toBe(true);
			expect(isRuleAutoFixable("UnusedLocalVariable")).toBe(true);
			expect(isRuleAutoFixable("MissingBSLDocComments")).toBe(true);
			expect(isRuleAutoFixable("MissingBSLDocMethod")).toBe(true);

			// Auto-fixable internal aliases
			expect(isRuleAutoFixable("EmptyExcept")).toBe(true);
			expect(isRuleAutoFixable("UnusedVariable")).toBe(true);
			expect(isRuleAutoFixable("MissingBSLDoc")).toBe(true);

			// Non-fixable codes
			expect(isRuleAutoFixable("CreateQueryInCycle")).toBe(false);
			expect(isRuleAutoFixable("QueryInLoop")).toBe(false);
			expect(isRuleAutoFixable("ServerModalCall")).toBe(false);
			expect(isRuleAutoFixable("UnknownRule")).toBe(false);
		});

		it("parses external diagnostics and marks canAutoFix for bsl-analyzer codes", () => {
			const json = JSON.stringify([
				{ file: "Mod.bsl", line: 10, code: "MissingCodeTryCatchEx", message: "Empty try" },
				{ file: "Mod.bsl", line: 20, code: "CreateQueryInCycle", message: "Query in loop" },
				{ file: "Mod.bsl", line: 30, code: "UnusedLocalVariable", message: "Unused var" },
			]);

			const violations = parseBslAnalyzerJsonOutput(json, "Default.bsl");
			expect(violations).toHaveLength(3);
			expect(violations[0].canAutoFix).toBe(true);
			expect(violations[1].canAutoFix).toBe(false);
			expect(violations[2].canAutoFix).toBe(true);
		});

		it("filters violations in bsl_fix_standards by canonical ruleId or alias", async () => {
			const code = `
Процедура Тест()
	Для Индекс = 1 По 10 Цикл
		Запрос = Новый Запрос;
		Запрос.Выполнить();
	КонецЦикла;
	Попытка
		ПодключитьВнешнююКомпоненту();
	Исключение
	КонецПопытки;
КонецПроцедуры
`;
			await fs.promises.writeFile(testFile, code, "utf8");

			let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
			const mockPi = {
				registerTool: vi.fn((tool) => {
					registeredTool = tool;
				}),
			} as unknown as ExtensionAPI;

			registerAutofixTools(mockPi);
			if (!registeredTool) throw new Error("tool not registered");

			// Request filter using canonical bsl-analyzer rule code MissingCodeTryCatchEx
			const result = await registeredTool.execute(
				"call_filter_canonical",
				{ target: testFile, dryRun: true, ruleIds: ["MissingCodeTryCatchEx"] },
				undefined,
				undefined,
				{} as ExtensionToolContext,
			);

			const details = result.details as { totalViolations: number; appliedFixes: number };
			expect(details.totalViolations).toBe(1);
			expect(details.appliedFixes).toBe(1);

			// Request filter using canonical bsl-analyzer rule code CreateQueryInCycle
			const resultQuery = await registeredTool.execute(
				"call_filter_cycle",
				{ target: testFile, dryRun: true, ruleIds: ["CreateQueryInCycle"] },
				undefined,
				undefined,
				{} as ExtensionToolContext,
			);

			const detailsQuery = resultQuery.details as { totalViolations: number; appliedFixes: number };
			expect(detailsQuery.totalViolations).toBe(1);
			expect(detailsQuery.appliedFixes).toBe(0); // QueryInLoop is not auto-fixable
		});

		it("generates patches for canonical bsl-analyzer rule code violations", () => {
			const code = `
Процедура Тест()
	Попытка
		X = 1;
	Исключение
	КонецПопытки;
КонецПроцедуры
`;
			const violations = [
				{
					ruleId: "MissingCodeTryCatchEx",
					ruleName: "MissingCodeTryCatchEx",
					message: "Пустой блок исключения",
					filePath: "Test.bsl",
					line: 4,
					column: 1,
					severity: "warning" as const,
					canAutoFix: true,
				},
			];

			const { fixedContent, appliedCount } = generatePatches("Test.bsl", code, violations);
			expect(appliedCount).toBe(1);
			expect(fixedContent).toContain("ЗаписьЖурналаРегистрации");
		});
	});

	describe("SDBL QueryVirtualTableParameterArity rule", () => {
		it("detects QueryVirtualTableParameterArity when calling РегистрНакопления.ТоварыНаСкладах.Остатки with 4 parameters instead of 2", () => {
			const code = `
Процедура ОстаткиПоСкладу()
	Запрос = Новый Запрос;
	Запрос.Текст =
	"ВЫБРАТЬ
	|	ТоварыНаСкладах.Номенклатура,
	|	ТоварыНаСкладах.КоличествоОстаток
	|ИЗ
	|	РегистрНакопления.ТоварыНаСкладах.Остатки(&МоментВремени, Склад = &Склад, Номенклатура, Количество) КАК ТоварыНаСкладах";
КонецПроцедуры
`;
			const violations = analyzeCodeForItsRules("Module.bsl", code);
			const arityViolation = violations.find((v) => v.ruleId === "QueryVirtualTableParameterArity");

			expect(arityViolation).toBeDefined();
			expect(arityViolation?.severity).toBe("error");
			expect(arityViolation?.canAutoFix).toBe(false);
			expect(arityViolation?.message).toBe(
				"Недопустимое количество параметров в виртуальной таблице 'Остатки': передано 4, максимально допустимо 2. Платформа 1С отклонит выполнение запроса.",
			);
		});

		it("does not report QueryVirtualTableParameterArity for valid Остатки calls with 0, 1, or 2 parameters", () => {
			const code = `
Процедура ВалидныеЗапросы()
	Запрос1 = "ВЫБРАТЬ * ИЗ РегистрНакопления.Товары.Остатки()";
	Запрос2 = "ВЫБРАТЬ * ИЗ РегистрНакопления.Товары.Остатки(&МоментВремени)";
	Запрос3 = "ВЫБРАТЬ * ИЗ РегистрНакопления.Товары.Остатки(&МоментВремени, Склад = &Склад)";
	Запрос4 = "ВЫБРАТЬ * ИЗ РегистрНакопления.Товары.Остатки(, Склад = &Склад)";
КонецПроцедуры
`;
			const violations = analyzeCodeForItsRules("Module.bsl", code);
			const arityViolations = violations.filter((v) => v.ruleId === "QueryVirtualTableParameterArity");

			expect(arityViolations).toHaveLength(0);
		});

		it("correctly handles nested parentheses, comments, and strings in virtual table arguments", () => {
			const code = `
Процедура СложныйЗапрос()
	Запрос = Новый Запрос;
	Запрос.Текст =
	"ВЫБРАТЬ
	|	*
	|ИЗ
	|	РегистрНакопления.Товары.Остатки(
	|		&Период, // Комментарий с запятой, скобкой (
	|		Номенклатура В (ВЫБРАТЬ Ссылка, Наименование ИЗ Справочник.Номенклатура)
	|	)";
КонецПроцедуры
`;
			const violations = analyzeCodeForItsRules("Module.bsl", code);
			const arityViolations = violations.filter((v) => v.ruleId === "QueryVirtualTableParameterArity");

			expect(arityViolations).toHaveLength(0);
		});

		it("verifies limits for all supported virtual table types (Russian and English)", () => {
			expect(VIRTUAL_TABLE_PARAM_LIMITS.остатки.max).toBe(2);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.balance.max).toBe(2);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.обороты.max).toBe(4);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.turnovers.max).toBe(4);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.остаткииобороты.max).toBe(5);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.balanceandturnovers.max).toBe(5);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.срезпоследних.max).toBe(2);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.slicelast.max).toBe(2);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.срезпервых.max).toBe(2);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.slicefirst.max).toBe(2);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.оборотыдткт.max).toBe(9);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.turnoversdrcr.max).toBe(9);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.субконто.max).toBe(5);
			expect(VIRTUAL_TABLE_PARAM_LIMITS.subconto.max).toBe(5);

			// Test Обороты exceeding 4 arguments
			const codeTurnovers = `Текст = "ВЫБРАТЬ * ИЗ РегистрНакопления.Продажи.Обороты(&Нач, &Кон, Месяц, Авто, Склад = &Склад)";`;
			const vTurnovers = analyzeCodeForItsRules("Mod.bsl", codeTurnovers);
			const errTurnovers = vTurnovers.find((v) => v.ruleId === "QueryVirtualTableParameterArity");
			expect(errTurnovers).toBeDefined();
			expect(errTurnovers?.message).toBe(
				"Недопустимое количество параметров в виртуальной таблице 'Обороты': передано 5, максимально допустимо 4. Платформа 1С отклонит выполнение запроса.",
			);

			// Test СрезПоследних exceeding 2 arguments
			const codeSlice = `Текст = "ВЫБРАТЬ * ИЗ РегистрСведений.Курсы.СрезПоследних(&Период, Валюта = &Валюта, Лишний)";`;
			const vSlice = analyzeCodeForItsRules("Mod.bsl", codeSlice);
			const errSlice = vSlice.find((v) => v.ruleId === "QueryVirtualTableParameterArity");
			expect(errSlice).toBeDefined();
			expect(errSlice?.message).toBe(
				"Недопустимое количество параметров в виртуальной таблице 'СрезПоследних': передано 3, максимально допустимо 2. Платформа 1С отклонит выполнение запроса.",
			);
		});

		it("parses arguments with parseVirtualTableArgs helper directly", () => {
			const call = "Остатки(&Момент, Склад = &Склад, Ном, Кол)";
			const openIndex = call.indexOf("(");
			const result = parseVirtualTableArgs(call, openIndex);
			expect(result.argCount).toBe(4);

			const emptyCall = "Остатки()";
			expect(parseVirtualTableArgs(emptyCall, emptyCall.indexOf("(")).argCount).toBe(0);

			const singleArg = "Остатки(&Момент)";
			expect(parseVirtualTableArgs(singleArg, singleArg.indexOf("(")).argCount).toBe(1);

			const twoArgs = "Остатки(&Момент, Склад = &Склад)";
			expect(parseVirtualTableArgs(twoArgs, twoArgs.indexOf("(")).argCount).toBe(2);
		});
	});

	describe("SKD XML template query analysis (Template.xml)", () => {
		it("extracts and checks queries inside Template.xml schema templates", () => {
			const xml = `<?xml version="1.0" encoding="UTF-8"?>
<DataCompositionSchema xmlns="http://v8.1c.ru/8.1/data-composition-system/schema">
	<dataSet xsi:type="DataSetQuery">
		<name>НаборДанных1</name>
		<query>ВЫБРАТЬ
	Товары.Склад,
	Товары.Номенклатура
ИЗ
	РегистрНакопления.ТоварыНаСкладах.Остатки(&amp;Период, Склад = &amp;Склад, Номенклатура, Количество) КАК Товары</query>
	</dataSet>
</DataCompositionSchema>`;
			const filePath = "src/Reports/Остатки/Templates/ОсновнаяСхема/Ext/Template.xml";
			const violations = analyzeCodeForItsRules(filePath, xml);
			const arityViolation = violations.find((v) => v.ruleId === "QueryVirtualTableParameterArity");

			expect(arityViolation).toBeDefined();
			expect(arityViolation?.severity).toBe("error");
			expect(arityViolation?.line).toBe(9); // line 9 in Template.xml
			expect(arityViolation?.filePath).toBe(filePath);
			expect(arityViolation?.message).toBe(
				"Недопустимое количество параметров в виртуальной таблице 'Остатки': передано 4, максимально допустимо 2. Платформа 1С отклонит выполнение запроса.",
			);
		});
	});

	describe("Directory batch processing in bsl_fix_standards", () => {
		it("supports directory target in bsl_fix_standards without EISDIR error and aggregates results", async () => {
			const commonModulesDir = path.join(tempDir, "CommonModules");
			const reportsDir = path.join(tempDir, "Reports");
			const nodeModulesDir = path.join(tempDir, "node_modules");
			const gitDir = path.join(tempDir, ".git");

			await fs.promises.mkdir(commonModulesDir, { recursive: true });
			await fs.promises.mkdir(reportsDir, { recursive: true });
			await fs.promises.mkdir(nodeModulesDir, { recursive: true });
			await fs.promises.mkdir(gitDir, { recursive: true });

			const mod1File = path.join(commonModulesDir, "Mod1.bsl");
			await fs.promises.writeFile(
				mod1File,
				`Процедура Тест()\n\tПопытка\n\t\tX = 1;\n\tИсключение\n\tКонецПопытки;\nКонецПроцедуры\n`,
				"utf8",
			);

			const mod2File = path.join(commonModulesDir, "Mod2.os");
			await fs.promises.writeFile(mod2File, `// Valid OneScript module\nСообщить("Привет");\n`, "utf8");

			const templateFile = path.join(reportsDir, "Template.xml");
			await fs.promises.writeFile(
				templateFile,
				`<query>ВЫБРАТЬ * ИЗ РегистрНакопления.ТоварыНаСкладах.Остатки(&amp;Период, Склад = &amp;Склад, Номенклатура, Количество)</query>`,
				"utf8",
			);

			// Files that MUST be ignored
			await fs.promises.writeFile(
				path.join(nodeModulesDir, "Ignored.bsl"),
				`Процедура Игнор()\n\tПопытка\n\tИсключение\n\tКонецПопытки;\nКонецПроцедуры\n`,
				"utf8",
			);
			await fs.promises.writeFile(
				path.join(gitDir, "Ignored.bsl"),
				`Процедура GitИгнор()\n\tПопытка\n\tИсключение\n\tКонецПопытки;\nКонецПроцедуры\n`,
				"utf8",
			);

			let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
			const mockPi = {
				registerTool: vi.fn((tool) => {
					registeredTool = tool;
				}),
			} as unknown as ExtensionAPI;

			registerAutofixTools(mockPi);
			if (!registeredTool) throw new Error("tool not registered");

			// Execute with target = tempDir (directory!)
			const result = await registeredTool.execute(
				"call_dir_1",
				{ target: tempDir, dryRun: true },
				undefined,
				undefined,
				{} as ExtensionToolContext,
			);

			expect(result.isError).toBeFalsy();
			const details = result.details as StandardFixResult;

			// Mod1.bsl has 1 EmptyExcept, Template.xml has 1 QueryVirtualTableParameterArity. Total = 2.
			// node_modules and .git ignored.
			expect(details.totalViolations).toBe(2);
			expect(details.appliedFixes).toBe(1); // EmptyExcept is auto-fixable in dry-run
			expect(details.remainingViolations).toHaveLength(1); // QueryVirtualTableParameterArity is not auto-fixable
			expect(details.remainingViolations[0].ruleId).toBe("QueryVirtualTableParameterArity");

			const textContent = result.content[0];
			if (textContent.type !== "text") throw new Error("expected text content");
			expect(textContent.text).toContain("[bsl_fix_standards: Анализ каталога");
			expect(textContent.text).toContain("Проверено файлов: 3"); // Mod1.bsl, Mod2.os, Template.xml
			expect(textContent.text).toContain("Mod1.bsl");
			expect(textContent.text).toContain("Template.xml");
			expect(textContent.text).not.toContain("Ignored.bsl");
		});
	});
});
