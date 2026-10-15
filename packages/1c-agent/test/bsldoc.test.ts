import { describe, expect, it } from "vitest";
import { generateBslDoc, inferParameterType, injectBslDocIntoModule, isBslDocComplete } from "../src/git/bsldoc.ts";
import { parseBslSymbols } from "../src/navigator/ast-parser.ts";
import type { BslAstSymbol, BslParameter } from "../src/types.ts";

describe("1C BSLDoc & Type Inference", () => {
	it("correctly infers standard 1C parameter types and descriptions", () => {
		expect(inferParameterType("Отказ")).toEqual({
			type: "Булево",
			description: "Признак отказа",
		});
		expect(inferParameterType("СтандартнаяОбработка")).toEqual({
			type: "Булево",
			description: "Признак выполнения стандартной обработки",
		});
		expect(inferParameterType("ДокументСсылка")).toEqual({
			type: "ДокументСсылка",
			description: "Ссылка на документ",
		});
		expect(inferParameterType("Структура")).toEqual({
			type: "Структура",
			description: "Структура с параметрами",
		});
		expect(inferParameterType("Имя")).toEqual({
			type: "Строка",
			description: "Строка Имя",
		});
		expect(inferParameterType("Число")).toEqual({
			type: "Число",
			description: "Числовое значение Число",
		});
		expect(inferParameterType("Период")).toEqual({
			type: "Дата",
			description: "Дата или период",
		});
		expect(inferParameterType("ТаблицаЗначений")).toEqual({
			type: "ТаблицаЗначений",
			description: "Таблица значений",
		});
	});

	it("validates BSLDoc completeness accurately", () => {
		const params: BslParameter[] = [
			{ name: "Отказ", defaultValue: undefined, byValue: false },
			{ name: "СтруктураПараметров", defaultValue: undefined, byValue: false },
		];

		// Missing doc completely
		expect(isBslDocComplete(undefined, params)).toBe(false);
		expect(isBslDocComplete("", params)).toBe(false);

		// Only empty comments or section headers
		expect(isBslDocComplete("//", params)).toBe(false);
		expect(isBslDocComplete("// Параметры:", params)).toBe(false);

		// Has description but missing parameters section
		expect(isBslDocComplete("// Проверяет заполнение документа.", params)).toBe(false);

		// Has parameters section but missing some parameters
		const partialDoc = [
			"// Проверяет заполнение документа.",
			"//",
			"// Параметры:",
			"//   Отказ - Булево - Признак отказа",
		].join("\n");
		expect(isBslDocComplete(partialDoc, params)).toBe(false);

		// Complete doc containing all parameters
		const completeDoc = [
			"// Проверяет заполнение документа.",
			"//",
			"// Параметры:",
			"//   Отказ - Булево - Признак отказа",
			"//   СтруктураПараметров - Структура - Параметры",
		].join("\n");
		expect(isBslDocComplete(completeDoc, params)).toBe(true);

		// Routine without parameters
		expect(isBslDocComplete("// Обработчик события.", [])).toBe(true);
		expect(isBslDocComplete("", [])).toBe(false);
	});

	it("generates BSLDoc conforming strictly to 1C ITS standards for procedures", () => {
		const symbol: BslAstSymbol = {
			name: "ПередЗаписью",
			type: "procedure",
			isExport: false,
			directive: "&НаСервере",
			startLine: 1,
			endLine: 5,
			parameters: [
				{ name: "Отказ", defaultValue: undefined, byValue: false },
				{ name: "РежимЗаписи", defaultValue: undefined, byValue: false },
			],
			calls: [],
			queries: [],
		};

		const doc = generateBslDoc(symbol);

		expect(doc).toContain("// Обработчик события ПередЗаписью.");
		expect(doc).toContain("// Параметры:");
		expect(doc).toContain("//   Отказ - Булево - Признак отказа");
		expect(doc).toContain("//   РежимЗаписи - ");
		expect(doc).not.toContain("Возвращаемое значение:");
	});

	it("generates BSLDoc conforming strictly to 1C ITS standards for functions", () => {
		const symbol: BslAstSymbol = {
			name: "ПолучитьИмяКлиента",
			type: "function",
			isExport: true,
			startLine: 1,
			endLine: 5,
			parameters: [{ name: "ДокументСсылка", defaultValue: undefined, byValue: false }],
			calls: [],
			queries: [],
		};

		const doc = generateBslDoc(symbol);

		expect(doc).toContain("// Возвращает ");
		expect(doc).toContain("// Параметры:");
		expect(doc).toContain("//   ДокументСсылка - ДокументСсылка - Ссылка на документ");
		expect(doc).toContain("// Возвращаемое значение:");
		expect(doc).toContain("//   Строка - Строковое значение");
	});

	it("injects BSLDoc before procedure without directive and without previous doc", () => {
		const sourceCode = ["Процедура РассчитатьИтоги(Сумма)", "\t// Тело", "КонецПроцедуры"].join("\n");

		const symbols = parseBslSymbols(sourceCode);
		expect(symbols).toHaveLength(1);

		const doc = generateBslDoc(symbols[0]);
		const injected = injectBslDocIntoModule(sourceCode, symbols[0], doc);

		expect(injected).toContain("// Рассчитывает Итоги.");
		expect(injected).toContain("// Параметры:");
		expect(injected).toContain("//   Сумма - Число - ");
		expect(injected.indexOf("// Рассчитывает Итоги.")).toBeLessThan(injected.indexOf("Процедура РассчитатьИтоги"));
	});

	it("injects BSLDoc before compiler directive &НаСервере", () => {
		const sourceCode = ["&НаСервере", "Процедура ОбработатьНаСервере(Отказ)", "\t// Тело", "КонецПроцедуры"].join(
			"\n",
		);

		const symbols = parseBslSymbols(sourceCode);
		expect(symbols).toHaveLength(1);

		const doc = generateBslDoc(symbols[0]);
		const injected = injectBslDocIntoModule(sourceCode, symbols[0], doc);

		expect(injected.indexOf("// Выполняет ОбработатьНаСервере.")).toBeLessThan(injected.indexOf("&НаСервере"));
		expect(injected.indexOf("&НаСервере")).toBeLessThan(injected.indexOf("Процедура ОбработатьНаСервере"));
	});

	it("replaces existing incomplete doc before directive", () => {
		const sourceCode = [
			"// Старый комментарий",
			"&НаКлиенте",
			"Функция ПроверитьЗаполнение()",
			"\tВозврат Истина;",
			"КонецФункции",
		].join("\n");

		const symbols = parseBslSymbols(sourceCode);
		expect(symbols).toHaveLength(1);

		const newDoc = [
			"// Проверяет корректность заполнения.",
			"//",
			"// Возвращаемое значение:",
			"//   Булево - Истина, если проверка пройдена",
		].join("\n");
		const injected = injectBslDocIntoModule(sourceCode, symbols[0], newDoc);

		expect(injected).not.toContain("// Старый комментарий");
		expect(injected).toContain("// Проверяет корректность заполнения.");
		expect(injected.indexOf("&НаКлиенте")).toBeGreaterThan(injected.indexOf("// Проверяет корректность заполнения."));
	});

	it("preserves module indentation when injecting BSLDoc", () => {
		const sourceCode = [
			"#Область Обработчики",
			"",
			"\t&НаСервере",
			"\tПроцедура МойМетод()",
			"\t\t//",
			"\tКонецПроцедуры",
			"",
			"#КонецОбласти",
		].join("\n");

		const symbols = parseBslSymbols(sourceCode);
		expect(symbols).toHaveLength(1);

		const doc = generateBslDoc(symbols[0]);
		const injected = injectBslDocIntoModule(sourceCode, symbols[0], doc);

		expect(injected).toContain("\t// Выполняет МойМетод.");
	});
});
