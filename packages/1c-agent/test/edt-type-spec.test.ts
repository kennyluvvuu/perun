// Тесты разбора описаний типов реквизитов и их XML-представления в формате EDT.

import { describe, expect, it } from "vitest";
import { parseTypeSpec, renderTypeXml } from "../src/edt/type-spec.ts";

function parts(spec: string) {
	const parsed = parseTypeSpec(spec);
	if (!parsed.ok) throw new Error(parsed.error);
	return parsed.parts;
}

describe("edt: type spec", () => {
	it("parses Russian and English primitive types with qualifiers", () => {
		expect(parts("Строка(50)")).toEqual([{ name: "String", length: 50 }]);
		expect(parts("String")).toEqual([{ name: "String", length: 100 }]);
		expect(parts("Строка(0)")).toEqual([{ name: "String", length: 0 }]);
		expect(parts("Число(15,2)")).toEqual([{ name: "Number", precision: 15, scale: 2, nonNegative: false }]);
		expect(parts("Число(15,3,неотр)")).toEqual([{ name: "Number", precision: 15, scale: 3, nonNegative: true }]);
		expect(parts("Булево")).toEqual([{ name: "Boolean" }]);
		expect(parts("ДатаВремя")).toEqual([{ name: "Date", dateFractions: "DateTime" }]);
		expect(parts("Date")).toEqual([{ name: "Date", dateFractions: "Date" }]);
	});

	it("maps Russian reference types and kind names to EDT reference types", () => {
		expect(parts("СправочникСсылка.Товары")).toEqual([{ name: "CatalogRef.Товары" }]);
		expect(parts("Справочник.Товары")).toEqual([{ name: "CatalogRef.Товары" }]);
		expect(parts("ДокументСсылка.Заказ")).toEqual([{ name: "DocumentRef.Заказ" }]);
		expect(parts("ПеречислениеСсылка.Статусы")).toEqual([{ name: "EnumRef.Статусы" }]);
		expect(parts("ОпределяемыйТип.Владелец")).toEqual([{ name: "DefinedType.Владелец" }]);
	});

	it("parses composite types separated by |", () => {
		expect(parts("СправочникСсылка.Товары | Строка(10)").map((part) => part.name)).toEqual([
			"CatalogRef.Товары",
			"String",
		]);
	});

	it("rejects unknown and non-reference types with a hint", () => {
		const unknown = parseTypeSpec("Целое");
		expect(unknown.ok).toBe(false);
		const register = parseTypeSpec("РегистрСведений.Цены");
		expect(register.ok).toBe(false);
		if (!register.ok) expect(register.error).toContain("СправочникСсылка.Цены");
		expect(parseTypeSpec("Число(40,2)").ok).toBe(false);
		expect(parseTypeSpec("").ok).toBe(false);
	});

	it("renders EDT type XML with qualifiers", () => {
		expect(renderTypeXml(parts("Число(15,2,неотр)"), "  ")).toEqual([
			"  <type>",
			"    <types>Number</types>",
			"    <numberQualifiers>",
			"      <precision>15</precision>",
			"      <scale>2</scale>",
			"      <nonNegative>true</nonNegative>",
			"    </numberQualifiers>",
			"  </type>",
		]);
		expect(renderTypeXml(parts("Строка(0)"), "")).toContain("  <stringQualifiers/>");
		expect(renderTypeXml(parts("Дата"), "").join("\n")).toContain("<dateFractions>Date</dateFractions>");
	});
});
