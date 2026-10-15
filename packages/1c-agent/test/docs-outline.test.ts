import { describe, expect, it } from "vitest";
import { buildModuleOutline, describeModule } from "../src/docs/index.ts";

const MODULE = `﻿// Общий модуль работы с остатками.\r
\r
#Область ПрограммныйИнтерфейс\r
\r
Перем КэшОстатков Экспорт; // кэш на время сеанса\r
\r
// Возвращает остаток товара на складе.\r
//\r
// Параметры:\r
//   Номенклатура - СправочникСсылка.Номенклатура - товар.\r
//   Склад - СправочникСсылка.Склады - склад.\r
//\r
// Возвращаемое значение:\r
//   Число - остаток.\r
&НаСервере\r
Функция ПолучитьОстаток(Номенклатура, Знач Склад = Неопределено) Экспорт\r
	Возврат РассчитатьОстаток(Номенклатура, Склад);\r
КонецФункции\r
\r
#КонецОбласти\r
\r
Процедура СброситьКэш()\r
	Перем Локальная;\r
	КэшОстатков = Неопределено;\r
КонецПроцедуры\r
`;

describe("docs: module outline", () => {
	it("extracts methods, module variables, regions and comments", () => {
		const outline = buildModuleOutline(MODULE);
		expect(outline.comment).toBe("Общий модуль работы с остатками.");
		const names = outline.symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);
		expect(names).toEqual(["variable:КэшОстатков", "function:ПолучитьОстаток", "procedure:СброситьКэш"]);

		const variable = outline.symbols[0];
		expect(variable.isExport).toBe(true);
		expect(variable.comment).toBe("кэш на время сеанса");
		expect(variable.region).toBe("ПрограммныйИнтерфейс");

		const fn = outline.symbols[1];
		expect(fn.signature).toBe("Функция ПолучитьОстаток(Номенклатура, Знач Склад = Неопределено) Экспорт");
		expect(fn.directive).toBe("&НаСервере");
		expect(fn.region).toBe("ПрограммныйИнтерфейс");
		expect(fn.comment).toContain("Возвращает остаток товара на складе.");
		expect(fn.calls).toContain("РассчитатьОстаток");
		expect(fn.line).toBe(16);

		expect(outline.symbols[2].region).toBeUndefined();
	});

	it("keeps symbol hashes stable across formatting-only changes", () => {
		const original = buildModuleOutline(MODULE);
		const reformatted = buildModuleOutline(
			MODULE.replace("\tВозврат РассчитатьОстаток", "    Возврат  РассчитатьОстаток"),
		);
		const changed = buildModuleOutline(MODULE.replace("Возврат РассчитатьОстаток", "Возврат 0 + РассчитатьОстаток"));
		expect(reformatted.symbols[1].hash).toBe(original.symbols[1].hash);
		expect(changed.symbols[1].hash).not.toBe(original.symbols[1].hash);
		expect(changed.hash).toBe(original.hash);
	});

	it("builds human-readable module titles from EDT paths", () => {
		expect(describeModule("src/CommonModules/ОбщегоНазначения/Module.bsl")).toBe("ОбщийМодуль.ОбщегоНазначения");
		expect(describeModule("src/Documents/Заказ/ObjectModule.bsl")).toBe("Документ.Заказ: Модуль объекта");
		expect(describeModule("src/Documents/Заказ/Forms/ФормаДокумента/Module.bsl")).toBe(
			"Документ.Заказ.Форма.ФормаДокумента",
		);
		expect(describeModule("src/Configuration/SessionModule.bsl")).toBe("Конфигурация: Модуль сеанса");
		expect(describeModule("scripts/tool.bsl")).toBe("scripts/tool");
	});
});
