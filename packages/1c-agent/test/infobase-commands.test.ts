// Тесты построения команд платформы, разбора вывода Конфигуратора и выбора базы из .v8-project.json.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	designerCheckCommand,
	designerLoadCommand,
	displayCommand,
	edtExportCommand,
	enterpriseCommand,
	ibcmdApplyCommand,
	ibcmdCreateCommand,
	ibcmdImportCommand,
} from "../src/infobase/commands.ts";
import { moduleSourcePath, parsePlatformOutput } from "../src/infobase/output-parser.ts";
import { connectionString, resolveInfobase } from "../src/infobase/project-config.ts";
import type { InfobaseTarget } from "../src/infobase/types.ts";

const FILE_IB: InfobaseTarget = { type: "file", path: "/w/build/ib", user: "Админ", password: "секрет" };

describe("infobase: commands", () => {
	it("builds 1cedtcli export with workspace before the command", () => {
		expect(edtExportCommand("/opt/edt/1cedtcli", "/w/ws", "/w/cfg", "/w/xml").args).toEqual([
			"-data",
			"/w/ws",
			"-command",
			"export",
			"--project",
			"/w/cfg",
			"--configuration-files",
			"/w/xml",
		]);
	});

	it("puts ibcmd connection options before nested commands", () => {
		expect(ibcmdImportCommand("ibcmd", "/w/data", FILE_IB, "/w/xml").args).toEqual([
			"infobase",
			"--data",
			"/w/data",
			"--db-path",
			"/w/build/ib",
			"config",
			"import",
			"--user",
			"Админ",
			"--password",
			"секрет",
			"/w/xml",
		]);
		expect(ibcmdApplyCommand("ibcmd", "/w/data", FILE_IB).args.slice(-1)).toEqual(["--force"]);
		expect(ibcmdCreateCommand("ibcmd", "/w/data", { type: "file", path: "/w/ib" }, "/w/xml").args).toEqual([
			"infobase",
			"--data",
			"/w/data",
			"--db-path",
			"/w/ib",
			"create",
			"--import=/w/xml",
			"--apply",
			"--force",
		]);
		expect(() => ibcmdApplyCommand("ibcmd", "/w/data", { type: "server", server: "srv", ref: "ib" })).toThrow(
			"файловых",
		);
	});

	it("builds designer and enterprise commands and masks passwords for display", () => {
		const load = designerLoadCommand("1cv8", FILE_IB, "/w/log.txt", "/w/xml");
		expect(load.args).toEqual([
			"DESIGNER",
			"/DisableStartupDialogs",
			"/DisableStartupMessages",
			"/F",
			"/w/build/ib",
			"/N",
			"Админ",
			"/P",
			"секрет",
			"/Out",
			"/w/log.txt",
			"/LoadConfigFromFiles",
			"/w/xml",
		]);
		expect(displayCommand(load)).toContain("/P *** /Out");
		expect(displayCommand(load)).not.toContain("секрет");
		expect(designerCheckCommand("1cv8", { type: "server", server: "srv", ref: "ut" }, "/w/c.log").args).toEqual(
			expect.arrayContaining(["/S", "srv\\ut", "/CheckConfig", "-ThinClient", "-Server", "-ExtendedModulesCheck"]),
		);
		const run = enterpriseCommand("1cv8c", { type: "file", path: "/w/ib" }, ["/UseHwLicenses+"], {
			execute: "/w/t.epf",
			url: "e1cib/list/Справочник.Товары",
		});
		expect(run.args).toEqual([
			"ENTERPRISE",
			"/DisableStartupDialogs",
			"/F",
			"/w/ib",
			"/Execute",
			"/w/t.epf",
			"/URL",
			"e1cib/list/Справочник.Товары",
			"/UseHwLicenses+",
		]);
	});
});

describe("infobase: platform output", () => {
	it("maps module locations to EDT source files", () => {
		expect(moduleSourcePath("ОбщийМодуль.Продажи.Модуль")).toBe("src/CommonModules/Продажи/Module.bsl");
		expect(moduleSourcePath("Документ.Заказ.МодульОбъекта")).toBe("src/Documents/Заказ/ObjectModule.bsl");
		expect(moduleSourcePath("Catalog.Items.ManagerModule")).toBe("src/Catalogs/Items/ManagerModule.bsl");
		expect(moduleSourcePath("Справочник.Товары.Форма.ФормаЭлемента.Форма")).toBe(
			"src/Catalogs/Товары/Forms/ФормаЭлемента/Module.bsl",
		);
		expect(moduleSourcePath("Документ.Заказ.Команда.Печать.МодульКоманды")).toBe(
			"src/Documents/Заказ/Commands/Печать/CommandModule.bsl",
		);
		expect(moduleSourcePath("РегистрНакопления.Остатки.МодульНабораЗаписей")).toBe(
			"src/AccumulationRegisters/Остатки/RecordSetModule.bsl",
		);
		expect(moduleSourcePath("Конфигурация.МодульСеанса")).toBe("src/Configuration/SessionModule.bsl");
		expect(moduleSourcePath("Непонятно.Что")).toBeUndefined();
	});

	it("parses designer check output into issues with source paths", () => {
		const issues = parsePlatformOutput(
			[
				"{ОбщийМодуль.Продажи.Модуль(12,3)}: Переменная не определена (Сумма)",
				"{1} : Сумма = Сумма + 1;",
				"Справочник.Товары Неразрешимые ссылки на объекты метаданных (1)",
				"Документ.Заказ Предупреждение: неиспользуемый реквизит",
				"Ошибок не обнаружено",
			].join("\n"),
		);
		expect(issues).toEqual([
			{
				severity: "error",
				location: "src/CommonModules/Продажи/Module.bsl:12:3",
				message: "Переменная не определена (Сумма)",
			},
			{
				severity: "error",
				location: "src/Catalogs/Товары",
				message: "Неразрешимые ссылки на объекты метаданных (1)",
			},
			{ severity: "warning", location: "src/Documents/Заказ", message: "Предупреждение: неиспользуемый реквизит" },
		]);
	});
});

describe("infobase: .v8-project.json", () => {
	let root: string;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), "perun-ib-"));
	});

	afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

	it("falls back to build/ib without a registry", () => {
		const resolved = resolveInfobase(root);
		expect(resolved).toMatchObject({
			id: "build/ib",
			target: { type: "file", path: path.join(root, "build", "ib") },
		});
		expect(resolveInfobase(root, "dev")).toContain("не найдена");
	});

	it("picks a database by name, alias, git branch and default", () => {
		const registry = {
			v8path: "/opt/1cv8/x86_64/8.3.27.1859",
			v8args: ["/UseHwLicenses+"],
			default: "dev",
			databases: [
				{ id: "dev", path: "ib/dev", user: "Админ", aliases: ["разработка"], branches: ["main"] },
				{ id: "test", server: "srv01", ref: "ut_test", aliases: ["тест"], branches: ["feature/*"] },
			],
		};
		fs.writeFileSync(path.join(root, ".v8-project.json"), JSON.stringify(registry));
		fs.mkdirSync(path.join(root, ".git"));
		fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/feature/orders\n");
		const byBranch = resolveInfobase(root);
		expect(byBranch).toMatchObject({
			id: "test",
			target: { type: "server", server: "srv01", ref: "ut_test" },
			extraArgs: ["/UseHwLicenses+"],
		});
		const byAlias = resolveInfobase(root, "Разработка");
		expect(byAlias).toMatchObject({
			id: "dev",
			target: { type: "file", path: path.join(root, "ib", "dev"), user: "Админ" },
		});
		fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/hotfix\n");
		expect(resolveInfobase(root)).toMatchObject({ id: "dev", source: ".v8-project.json (default)" });
		expect(connectionString({ type: "server", server: "srv01", ref: "ut_test" })).toBe("/Ssrv01\\ut_test");
	});
});
