// Тесты проверки .mdo: синтаксис, имя и каталог, регистрация, ссылки, дубли UUID и имён, ресурсы регистров.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mdoFeedbackText } from "../src/edt/feedback.ts";
import { findKind } from "../src/edt/metadata-kinds.ts";
import { createObject } from "../src/edt/scaffold-service.ts";
import type { MdoRef } from "../src/edt/types.ts";
import { validateMdoText } from "../src/edt/validate-file.ts";
import { validateProject } from "../src/edt/validate-project.ts";
import { createValidationContext } from "../src/edt/validate-references.ts";
import { createEdtFixture, type EdtFixture } from "./helpers/edt-fixture.ts";

function ref(kind: string, name: string): MdoRef {
	const info = findKind(kind);
	if (!info) throw new Error(kind);
	return { kind: info, name };
}

const CATALOG = "src/Catalogs/Товары/Товары.mdo";

describe("edt: validation", () => {
	let fixture: EdtFixture;

	beforeEach(() => {
		fixture = createEdtFixture();
		createObject(fixture.project, {
			ref: ref("Справочник", "Товары"),
			attributes: [{ name: "Артикул", type: "Строка(25)" }],
		});
	});

	afterEach(() => fixture.cleanup());

	function check(relativePath: string, text: string): string[] {
		const filePath = fixture.write(relativePath, text);
		return validateMdoText(createValidationContext(fixture.project), filePath, text).map(
			(item) => `${item.line}: ${item.message}`,
		);
	}

	it("reports XML syntax errors with line numbers", () => {
		const broken = fixture.read(CATALOG).replace("</name>", "</nam>");
		const messages = check(CATALOG, broken);
		expect(messages).toHaveLength(1);
		expect(messages[0]).toMatch(/^\d+: синтаксис XML/);
	});

	it("reports name/file mismatch, wrong folder and missing registration", () => {
		const text = fixture.read(CATALOG).replace("<name>Товары</name>", "<name>Товар</name>");
		expect(check(CATALOG, text).join("\n")).toContain("не совпадает с именем файла");
		const moved = fixture.read(CATALOG);
		expect(check("src/Documents/Товары/Товары.mdo", moved).join("\n")).toContain("лежит в каталоге Documents");
		const copy = fixture.read(CATALOG).replace(/<name>Товары<\/name>/, "<name>Услуги</name>");
		expect(check("src/Catalogs/Услуги/Услуги.mdo", copy).join("\n")).toContain("не зарегистрирован");
	});

	it("reports references to missing objects", () => {
		const text = fixture.read(CATALOG).replace("<types>String</types>", "<types>CatalogRef.Нет</types>");
		expect(check(CATALOG, text).join("\n")).toContain("несуществующий объект Catalogs/Нет");
	});

	it("reports duplicate child names and invalid identifiers", () => {
		const text = fixture.read(CATALOG);
		const attribute = text.slice(
			text.indexOf("  <attributes"),
			text.indexOf("  </attributes>") + "  </attributes>".length,
		);
		const duplicated = text.replace(
			attribute,
			`${attribute}\n${attribute.replace(/uuid="[^"]+"/, 'uuid="0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"')}`,
		);
		const messages = check(CATALOG, duplicated).join("\n");
		expect(messages).toContain("используется повторно");
		const invalid = text.replace("<name>Артикул</name>", "<name>Арт икул</name>");
		expect(check(CATALOG, invalid).join("\n")).toContain("не является допустимым идентификатором");
	});

	it("detects UUIDs copied between files across the project", () => {
		const copy = fixture.read(CATALOG).replace(/<name>Товары<\/name>/, "<name>Услуги</name>");
		fixture.write("src/Catalogs/Услуги/Услуги.mdo", copy);
		const configurationPath = "src/Configuration/Configuration.mdo";
		fixture.write(
			configurationPath,
			fixture
				.read(configurationPath)
				.replace("</mdclass:Configuration>", "  <catalogs>Catalog.Услуги</catalogs>\n</mdclass:Configuration>"),
		);
		const messages = validateProject(fixture.project)
			.diagnostics.map((item) => item.message)
			.join("\n");
		expect(messages).toContain("уже используется в src/Catalogs/Товары/Товары.mdo");
	});

	it("reports registered objects without files and non-numeric accumulation resources", () => {
		const configurationPath = "src/Configuration/Configuration.mdo";
		const configuration = fixture
			.read(configurationPath)
			.replace("</mdclass:Configuration>", "  <documents>Document.Нет</documents>\n</mdclass:Configuration>");
		expect(check(configurationPath, configuration).join("\n")).toContain(
			"зарегистрирован, но файла Documents/Нет/Нет.mdo нет",
		);
		createObject(fixture.project, {
			ref: ref("РегистрНакопления", "Остатки"),
			resources: [{ name: "Количество", type: "Число(15,3)" }],
		});
		const registerPath = "src/AccumulationRegisters/Остатки/Остатки.mdo";
		const register = fixture.read(registerPath).replace("<types>Number</types>", "<types>String</types>");
		expect(check(registerPath, register).join("\n")).toContain("должен иметь тип Number");
	});

	it("produces inline feedback only for broken .mdo files", () => {
		const filePath = fixture.write(CATALOG, fixture.read(CATALOG));
		expect(mdoFeedbackText(filePath)).toBeUndefined();
		fixture.write(CATALOG, fixture.read(CATALOG).replace("<types>String</types>", "<types>EnumRef.Нет</types>"));
		expect(mdoFeedbackText(filePath)).toContain("[проверка .mdo]");
		expect(mdoFeedbackText(`${fixture.project.root}/src/Catalogs/Товары/ObjectModule.bsl`)).toBeUndefined();
	});
});
