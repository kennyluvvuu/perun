import { describe, expect, it } from "vitest";
import {
	extractCalls,
	extractQueries,
	extractTablesFromQuery,
	parseBslParameters,
	parseBslSymbols,
} from "../src/navigator/ast-parser.ts";

describe("BSL AST Parser", () => {
	it("parses procedure and function parameters with defaults and Знач", () => {
		const raw = "Знач ДокументСсылка, Сумма = 0, РежимПроведения = Неопределено";
		const params = parseBslParameters(raw);

		expect(params).toHaveLength(3);
		expect(params[0]).toEqual({
			name: "ДокументСсылка",
			defaultValue: undefined,
			byValue: true,
		});
		expect(params[1]).toEqual({
			name: "Сумма",
			defaultValue: "0",
			byValue: false,
		});
		expect(params[2]).toEqual({
			name: "РежимПроведения",
			defaultValue: "Неопределено",
			byValue: false,
		});
	});

	it("extracts SDBL queries and source tables from query strings", () => {
		const queryText = `
			ВЫБРАТЬ
				Заказ.Ссылка КАК Ссылка,
				Заказ.Сумма КАК Сумма,
				Остатки.КоличествоОстаток КАК Остаток
			ИЗ
				Документ.ЗаказКлиента КАК Заказ
				ЛЕВОЕ СОЕДИНЕНИЕ РегистрНакопления.ОстаткиТоваров.Остатки() КАК Остатки
				ПО Заказ.Номенклатура = Остатки.Номенклатура
		`;

		const tables = extractTablesFromQuery(queryText);
		expect(tables).toContain("Документ.ЗаказКлиента");
		expect(tables).toContain("РегистрНакопления.ОстаткиТоваров.Остатки");
	});

	it("extracts calls while ignoring language keywords", () => {
		const body = `
			Если ПроверитьЗаполнение() Тогда
				РассчитатьИтоги(Сумма);
				Пока Не Заполнено() Цикл
					ЗаполнитьПоУмолчанию();
				КонецЦикла;
			КонецЕсли;
		`;

		const calls = extractCalls(body);
		expect(calls).toContain("ПроверитьЗаполнение");
		expect(calls).toContain("РассчитатьИтоги");
		expect(calls).toContain("Заполнено");
		expect(calls).toContain("ЗаполнитьПоУмолчанию");
		expect(calls).not.toContain("Если");
		expect(calls).not.toContain("Пока");
	});

	it("parses procedures, functions, directives, exports, and BSLDoc in a full module", () => {
		const code = `
&НаСервере
// Выполняет расчет себестоимости партии
//
// Параметры:
//   Партия - ДокументСсылка.ПоступлениеТоваров
//
Процедура РассчитатьСебестоимость(Знач Партия, Режим = 1) Экспорт
	Запрос = Новый Запрос;
	Запрос.Текст = 
		"ВЫБРАТЬ
		|	Товары.Сумма
		|ИЗ
		|	Документ.ПоступлениеТоваров.Товары КАК Товары";
	Результат = Запрос.Выполнить();
	ЗафиксироватьРезультат(Результат);
КонецПроцедуры

&НаКлиенте
Функция ПолучитьТекущийСтатус(Код)
	Возврат НайтиСтатусПоКоду(Код);
КонецФункции
`;

		const symbols = parseBslSymbols(code);
		expect(symbols).toHaveLength(2);

		const proc = symbols[0];
		expect(proc.name).toBe("РассчитатьСебестоимость");
		expect(proc.type).toBe("procedure");
		expect(proc.isExport).toBe(true);
		expect(proc.directive).toBe("&НаСервере");
		expect(proc.bslDoc).toContain("Выполняет расчет себестоимости партии");
		expect(proc.parameters).toHaveLength(2);
		expect(proc.parameters[0].byValue).toBe(true);
		expect(proc.parameters[1].defaultValue).toBe("1");
		expect(proc.calls).toContain("ЗафиксироватьРезультат");
		expect(proc.queries).toHaveLength(1);
		expect(proc.queries[0].tables).toContain("Документ.ПоступлениеТоваров.Товары");

		const func = symbols[1];
		expect(func.name).toBe("ПолучитьТекущийСтатус");
		expect(func.type).toBe("function");
		expect(func.isExport).toBe(false);
		expect(func.directive).toBe("&НаКлиенте");
		expect(func.calls).toContain("НайтиСтатусПоКоду");
	});

	it("parses multiline procedure declarations with preprocessor directives and BSLDoc", () => {
		const code = `
#Область Обработчики
// Документация многострочного метода
//
// Параметры:
//   Параметр1 - Число
//
&НаСервере
Процедура СложныйРасчет(
	Знач Параметр1,
	Параметр2 = "Тест",
	Параметр3 = Истина
) Экспорт
	ВыполнитьДействие(Параметр1);
КонецПроцедуры
#КонецОбласти
`;
		const symbols = parseBslSymbols(code);
		expect(symbols).toHaveLength(1);

		const proc = symbols[0];
		expect(proc.name).toBe("СложныйРасчет");
		expect(proc.type).toBe("procedure");
		expect(proc.isExport).toBe(true);
		expect(proc.directive).toBe("&НаСервере");
		expect(proc.bslDoc).toContain("Документация многострочного метода");
		expect(proc.parameters).toHaveLength(3);
		expect(proc.parameters[0].name).toBe("Параметр1");
		expect(proc.parameters[0].byValue).toBe(true);
		expect(proc.parameters[1].defaultValue).toBe('"Тест"');
		expect(proc.calls).toContain("ВыполнитьДействие");
	});

	it("extracts multiple tables and dynamic concatenation from queries", () => {
		const queryText = `
			ВЫБРАТЬ *
			ИЗ Документ.ЗаказКлиента КАК Заказ
			| ВНУТРЕННЕЕ СОЕДИНЕНИЕ РегистрНакопления.ОстаткиТоваров КАК Остатки
			| ПО Заказ.Номенклатура = Остатки.Номенклатура
			| ЛЕВОЕ СОЕДИНЕНИЕ " + ИмяТаблицыЦен + " КАК Цены
		`;
		const tables = extractTablesFromQuery(queryText);
		expect(tables).toContain("Документ.ЗаказКлиента");
		expect(tables).toContain("РегистрНакопления.ОстаткиТоваров");
		expect(tables).toContain("ИмяТаблицыЦен");
	});

	it("detects queries starting directly with Cyrillic ВЫБРАТЬ without Запрос.Текст", () => {
		const code = `
Процедура ЗапуститьВыборку()
	Текст = "ВЫБРАТЬ Ссылка ИЗ Справочник.Склады";
КонецПроцедуры
`;
		const queries = extractQueries(code);
		expect(queries).toHaveLength(1);
		expect(queries[0].tables).toContain("Справочник.Склады");
	});

	it("does not false-match words ending in Cyrillic из like Анализ as table source", () => {
		const text = "Анализ Справочник.Склады";
		const tables = extractTablesFromQuery(text);
		expect(tables).toHaveLength(0);
	});
});
