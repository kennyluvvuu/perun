// Тесты сценариев 1c_ib на подменённом запуске процессов: порядок команд сборки, остановка на ошибке, понятные отказы.

import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	buildInfobase,
	checkConfiguration,
	formatSteps,
	type IbContext,
	updateDatabase,
} from "../src/infobase/build-service.ts";
import type { CommandSpec, PlatformTools, ProcessOutcome } from "../src/infobase/types.ts";
import { createEdtFixture, type EdtFixture } from "./helpers/edt-fixture.ts";

describe("infobase: build scenarios", () => {
	let fixture: EdtFixture;
	let calls: CommandSpec[];

	beforeEach(() => {
		fixture = createEdtFixture();
		calls = [];
	});

	afterEach(() => fixture.cleanup());

	function context(
		tools: PlatformTools,
		outcome: (spec: CommandSpec) => ProcessOutcome = () => ({ exitCode: 0, stdout: "", stderr: "" }),
	): IbContext {
		return {
			workspaceRoot: fixture.workspace,
			edtProject: fixture.project,
			infobase: {
				id: "build/ib",
				source: "test",
				target: { type: "file", path: path.join(fixture.workspace, "build", "ib") },
				extraArgs: [],
			},
			tools,
			run: async (spec) => {
				calls.push(spec);
				return outcome(spec);
			},
		};
	}

	const titles = (): string[] => calls.map((spec) => spec.title.split(" (")[0] ?? spec.title);

	it("exports EDT and creates a new file infobase with ibcmd in one step", async () => {
		const steps = await buildInfobase(context({ edtCli: "1cedtcli", ibcmd: "ibcmd" }));
		expect(typeof steps).not.toBe("string");
		expect(titles()).toEqual(["Выгрузка EDT-проекта в XML", "Создание файловой базы с конфигурацией"]);
		expect(calls[0]?.args).toContain(fixture.project.root);
		expect(calls[1]?.args).toContain(`--import=${path.join(fixture.workspace, "build", "perun", "xml")}`);
	});

	it("imports and applies into an existing infobase", async () => {
		const ibPath = path.join(fixture.workspace, "build", "ib");
		fs.mkdirSync(ibPath, { recursive: true });
		fs.writeFileSync(path.join(ibPath, "1Cv8.1CD"), "");
		await buildInfobase(context({ edtCli: "1cedtcli", ibcmd: "ibcmd" }));
		expect(titles()).toEqual([
			"Выгрузка EDT-проекта в XML",
			"Загрузка конфигурации из XML",
			"Обновление конфигурации базы данных",
		]);
	});

	it("falls back to the designer when ibcmd is missing", async () => {
		await buildInfobase(context({ edtCli: "1cedtcli", designer: "1cv8" }));
		expect(titles()).toEqual([
			"Выгрузка EDT-проекта в XML",
			"Создание файловой базы",
			"Загрузка конфигурации из XML",
			"Обновление конфигурации базы данных",
		]);
	});

	it("stops at the first failing step and reports platform issues with source paths", async () => {
		const steps = await buildInfobase(
			context({ edtCli: "1cedtcli", designer: "1cv8" }, (spec) =>
				spec.args.includes("/LoadConfigFromFiles")
					? { exitCode: 1, stdout: "{Документ.Заказ.МодульОбъекта(7,2)}: Ожидается символ ';'", stderr: "" }
					: { exitCode: 0, stdout: "", stderr: "" },
			),
		);
		if (typeof steps === "string") throw new Error(steps);
		expect(steps.map((step) => step.ok)).toEqual([true, true, false]);
		const text = formatSteps(steps);
		expect(text).toContain("ОШИБКА — Загрузка конфигурации из XML");
		expect(text).toContain("src/Documents/Заказ/ObjectModule.bsl:7:2 Ожидается символ ';'");
	});

	it("explains what is missing instead of failing obscurely", async () => {
		expect(await buildInfobase(context({ ibcmd: "ibcmd" }))).toContain("не найден 1C:EDT CLI");
		expect(await buildInfobase(context({ edtCli: "1cedtcli" }))).toContain("не найдена платформа 1С");
		expect(await checkConfiguration(context({ ibcmd: "ibcmd" }))).toContain("нужен 1cv8");
		expect(await updateDatabase(context({}))).toContain("не найдена платформа 1С");
		expect(calls).toEqual([]);
	});
});
