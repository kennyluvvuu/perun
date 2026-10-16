// Тесты создания и дополнения объектов EDT: файлы, регистрация, подсистема, модули и прохождение проверки.

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readMdo } from "../src/edt/mdo-reader.ts";
import { findKind } from "../src/edt/metadata-kinds.ts";
import { addToObject, createObject } from "../src/edt/scaffold-service.ts";
import type { MdoRef } from "../src/edt/types.ts";
import { validateProject } from "../src/edt/validate-project.ts";
import { createEdtFixture, type EdtFixture } from "./helpers/edt-fixture.ts";

function ref(kind: string, name: string): MdoRef {
	const info = findKind(kind);
	if (!info) throw new Error(kind);
	return { kind: info, name };
}

describe("edt: scaffold", () => {
	let fixture: EdtFixture;

	beforeEach(() => {
		fixture = createEdtFixture();
	});

	afterEach(() => fixture.cleanup());

	function createSupplyChain(): void {
		const { project } = fixture;
		createObject(project, {
			ref: ref("Справочник", "Товары"),
			attributes: [{ name: "Артикул", type: "Строка(25)", indexed: true }],
			subsystem: "Склад",
		});
		createObject(project, { ref: ref("Перечисление", "Статусы"), values: [{ name: "Новый" }, { name: "Закрыт" }] });
		createObject(project, {
			ref: ref("РегистрНакопления", "Остатки"),
			dimensions: [{ name: "Товар", type: "СправочникСсылка.Товары" }],
			resources: [{ name: "Количество", type: "Число(15,3)" }],
		});
		createObject(project, {
			ref: ref("Документ", "Поступление"),
			attributes: [{ name: "Статус", type: "ПеречислениеСсылка.Статусы", required: true }],
			tabularSections: [
				{
					name: "Товары",
					attributes: [
						{ name: "Товар", type: "СправочникСсылка.Товары" },
						{ name: "Количество", type: "Число(15,3,неотр)" },
					],
				},
			],
			registerRecords: ["РегистрНакопления.Остатки"],
		});
	}

	it("creates a consistent set of objects that passes project validation", () => {
		createSupplyChain();
		const { project } = fixture;
		createObject(project, { ref: ref("ОбщийМодуль", "ПоступлениеСервер"), options: { context: "serverCall" } });
		createObject(project, {
			ref: ref("РегистрСведений", "Цены"),
			dimensions: [{ name: "Товар", type: "СправочникСсылка.Товары" }],
			resources: [{ name: "Цена", type: "Число(15,2)" }],
			options: { periodicity: "Day" },
		});
		createObject(project, { ref: ref("Константа", "ОсновнойТовар"), options: { type: "СправочникСсылка.Товары" } });
		createObject(project, { ref: ref("Обработка", "Загрузка"), attributes: [{ name: "Файл", type: "Строка(0)" }] });

		const result = validateProject(project);
		expect(result.diagnostics).toEqual([]);
		expect(result.files).toBe(10);
	});

	it("registers objects in canonical order and adds subsystem content", () => {
		createSupplyChain();
		const configuration = fixture.read("src/Configuration/Configuration.mdo");
		const order = [
			"<subsystems>",
			"<catalogs>Catalog.Товары",
			"<documents>Document.Поступление",
			"<enums>Enum.Статусы",
			"<accumulationRegisters>",
		].map((needle) => configuration.indexOf(needle));
		expect(order.every((index) => index > 0)).toBe(true);
		expect([...order].sort((left, right) => left - right)).toEqual(order);
		expect(fixture.read("src/Subsystems/Склад/Склад.mdo")).toContain("  <content>Catalog.Товары</content>");
	});

	it("writes posting stub with register records and module skeletons", () => {
		createSupplyChain();
		const module = fixture.read("src/Documents/Поступление/ObjectModule.bsl");
		expect(module.startsWith(`${String.fromCharCode(0xfeff)}#Если Сервер`)).toBe(true);
		expect(module).toContain("Процедура ОбработкаПроведения(Отказ, РежимПроведения)");
		expect(module).toContain("Движения.Остатки.Записывать = Истина;");
		expect(
			fs.existsSync(path.join(fixture.project.srcDir, "AccumulationRegisters", "Остатки", "RecordSetModule.bsl")),
		).toBe(true);
		const document = readMdo(fixture.read("src/Documents/Поступление/Поступление.mdo"));
		expect(document?.registerRecords).toEqual(["AccumulationRegister.Остатки"]);
		expect(document?.tabularSections[0]?.attributes.map((item) => item.typeText)).toEqual([
			"CatalogRef.Товары",
			"Number(15,3,неотр)",
		]);
	});

	it("adds attributes to an existing object and to its tabular section", () => {
		createSupplyChain();
		const { project } = fixture;
		const report = addToObject(project, ref("Документ", "Поступление"), {
			attributes: [{ name: "Комментарий", type: "Строка(0)" }],
		});
		expect(report.diagnostics).toEqual([]);
		addToObject(project, ref("Документ", "Поступление"), {
			tabularSection: "Товары",
			attributes: [{ name: "Цена", type: "Число(15,2)" }],
		});
		const document = readMdo(fixture.read("src/Documents/Поступление/Поступление.mdo"));
		expect(document?.attributes.map((item) => item.name)).toEqual(["Статус", "Комментарий"]);
		expect(document?.tabularSections[0]?.attributes.map((item) => item.name)).toEqual([
			"Товар",
			"Количество",
			"Цена",
		]);
		expect(validateProject(project).diagnostics).toEqual([]);
	});

	it("refuses duplicates, missing registers, non-numeric resources and existing objects", () => {
		createSupplyChain();
		const { project } = fixture;
		expect(() =>
			addToObject(project, ref("Справочник", "Товары"), { attributes: [{ name: "артикул", type: "Строка(5)" }] }),
		).toThrow("уже есть");
		expect(() =>
			createObject(project, { ref: ref("Документ", "Расход"), registerRecords: ["РегистрНакопления.Нет"] }),
		).toThrow("не найден");
		expect(() =>
			createObject(project, {
				ref: ref("РегистрНакопления", "Продажи"),
				resources: [{ name: "Сумма", type: "Строка(10)" }],
			}),
		).toThrow("числом");
		expect(() => createObject(project, { ref: ref("Справочник", "Товары") })).toThrow("уже существует");
		expect(() => createObject(project, { ref: ref("Справочник", "1Плохое") })).toThrow("допустимым именем");
		expect(() => createObject(project, { ref: ref("ПланСчетов", "Основной") })).toThrow("не поддерживается");
	});

	it("preserves CRLF line endings when editing existing files", () => {
		const configurationPath = "src/Configuration/Configuration.mdo";
		fixture.write(configurationPath, fixture.read(configurationPath).replace(/\n/g, "\r\n"));
		createObject(fixture.project, { ref: ref("Справочник", "Склады") });
		const configuration = fixture.read(configurationPath);
		expect(configuration).toContain("  <catalogs>Catalog.Склады</catalogs>\r\n");
		expect(configuration.replace(/\r\n/g, "")).not.toContain("\n");
	});
});
