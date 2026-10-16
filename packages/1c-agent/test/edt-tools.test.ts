// Тесты инструмента 1c_md через регистрацию в pi: create, add, info, validate и сообщения об ошибках.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMetadataTools } from "../src/edt/tools.ts";
import { createEdtFixture, type EdtFixture } from "./helpers/edt-fixture.ts";

interface ToolText {
	readonly text: string;
	readonly isError: boolean;
}

type Execute = (
	id: string,
	params: Record<string, unknown>,
	signal: undefined,
	update: undefined,
	ctx: ExtensionToolContext,
) => Promise<{
	content: Array<{ type: string; text?: string }>;
	isError?: boolean;
}>;

describe("edt: 1c_md tool", () => {
	let fixture: EdtFixture;
	let execute: Execute;

	beforeEach(() => {
		fixture = createEdtFixture();
		const pi = {
			registerTool: vi.fn((tool: { name: string; execute: Execute }) => {
				if (tool.name === "1c_md") execute = tool.execute;
			}),
		} as unknown as ExtensionAPI;
		registerMetadataTools(pi);
	});

	afterEach(() => fixture.cleanup());

	async function call(params: Record<string, unknown>, cwd = fixture.workspace): Promise<ToolText> {
		const result = await execute("id", params, undefined, undefined, { cwd } as ExtensionToolContext);
		return { text: result.content.map((item) => item.text ?? "").join("\n"), isError: Boolean(result.isError) };
	}

	it("creates an object and reports created files and a clean check", async () => {
		const result = await call({
			action: "create",
			object: "Справочник.Контрагенты",
			attributes: [{ name: "ИНН", type: "Строка(12)", indexed: true }],
			subsystem: "Склад",
		});
		expect(result.isError).toBe(false);
		expect(result.text).toContain(
			"Создано: src/Catalogs/Контрагенты/Контрагенты.mdo, src/Catalogs/Контрагенты/ObjectModule.bsl",
		);
		expect(result.text).toContain("Изменено: src/Configuration/Configuration.mdo, src/Subsystems/Склад/Склад.mdo");
		expect(result.text).toContain("Проверка .mdo: замечаний нет.");
	});

	it("describes an object with types, the configuration overview and the list of a kind", async () => {
		await call({
			action: "create",
			object: "Справочник.Контрагенты",
			attributes: [{ name: "ИНН", type: "Строка(12)" }],
		});
		const object = await call({ action: "info", object: "Справочник.Контрагенты" });
		expect(object.text).toContain("Справочник.Контрагенты (Catalog) — «Контрагенты»");
		expect(object.text).toContain("ИНН: String(12)");
		expect(object.text).toContain("Модули: ObjectModule.bsl");
		const overview = await call({ action: "info" });
		expect(overview.text).toContain(
			"Конфигурация ТестоваяКонфигурация (режим совместимости 8.3.27, язык синонимов ru)",
		);
		expect(overview.text).toContain("Справочник: 1");
		const list = await call({ action: "info", object: "Справочник" });
		expect(list.text).toContain("Контрагенты");
		const missing = await call({ action: "info", object: "Справочник.Контр" });
		expect(missing.text).toContain("не найден. Похожие: Контрагенты");
	});

	it("validates the whole project", async () => {
		const clean = await call({ action: "validate" });
		expect(clean).toEqual({ text: "Проверено файлов .mdo: 2. Замечаний нет.", isError: false });
		fixture.write("src/Catalogs/Сломан/Сломан.mdo", "<mdclass:Catalog");
		const broken = await call({ action: "validate" });
		expect(broken.isError).toBe(true);
		expect(broken.text).toContain("src/Catalogs/Сломан/Сломан.mdo:1: ошибка: синтаксис XML");
	});

	it("returns clear errors for bad input and missing project", async () => {
		const noObject = await call({ action: "create" });
		expect(noObject.isError).toBe(true);
		expect(noObject.text).toContain("укажите object в виде «Вид.Имя»");
		const badType = await call({
			action: "create",
			object: "Документ.Заказ",
			attributes: [{ name: "Х", type: "Целое" }],
		});
		expect(badType.isError).toBe(true);
		expect(badType.text).toContain("неизвестный тип «Целое»");
		const empty = fs.mkdtempSync(path.join(os.tmpdir(), "perun-empty-"));
		const noProject = await call({ action: "info" }, empty);
		fs.rmSync(empty, { recursive: true, force: true });
		expect(noProject.isError).toBe(true);
		expect(noProject.text).toContain("EDT-проект не найден");
	});
});
