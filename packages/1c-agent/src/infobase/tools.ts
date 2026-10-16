// Инструмент 1c_ib: состояние окружения, сборка EDT-проекта в базу, обновление БД, проверка платформой и запуск клиента.

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { resolveEdtProject } from "../edt/tools.ts";
import {
	buildInfobase,
	checkConfiguration,
	formatSteps,
	type IbContext,
	launchClient,
	updateDatabase,
} from "./build-service.ts";
import { locatePlatformTools } from "./platform-locator.ts";
import { runProcess } from "./process-runner.ts";
import { resolveInfobase } from "./project-config.ts";
import type { ProcessRunner, StepResult } from "./types.ts";

const IB_SCHEMA = Type.Object({
	action: Type.Union(
		[
			Type.Literal("status"),
			Type.Literal("build"),
			Type.Literal("update"),
			Type.Literal("check"),
			Type.Literal("run"),
		],
		{
			description:
				"status — какая база и утилиты найдены; build — выгрузить EDT-проект и загрузить в базу с обновлением БД; update — только обновить конфигурацию БД; check — проверка конфигурации и модулей платформой; run — открыть базу в клиенте для пользователя",
		},
	),
	database: Type.Optional(
		Type.String({ description: "id или алиас базы из .v8-project.json (по умолчанию — по ветке Git или default)" }),
	),
	execute: Type.Optional(Type.String({ description: "run: внешняя обработка .epf для /Execute" })),
	startupParameter: Type.Optional(Type.String({ description: "run: параметр запуска /C" })),
	url: Type.Optional(Type.String({ description: "run: навигационная ссылка e1cib/…" })),
});

type IbParams = Static<typeof IB_SCHEMA>;

export function isReadOnlyIbCall(input: unknown): boolean {
	const action = typeof input === "object" && input !== null ? (input as { action?: unknown }).action : undefined;
	return action === "status";
}

function describeStatus(context: IbContext): string {
	const { target } = context.infobase;
	const where =
		target.type === "file"
			? `файловая ${target.path} (${fs.existsSync(path.join(target.path, "1Cv8.1CD")) ? "создана" : "ещё не создана — build создаст"})`
			: `серверная ${target.server}\\${target.ref}`;
	const tool = (name: string, value: string | undefined): string => `${name}: ${value ?? "не найден"}`;
	return [
		`База: ${context.infobase.id} — ${where}; источник: ${context.infobase.source}`,
		`EDT-проект: ${context.edtProject ? `${context.edtProject.root} (платформа ${context.edtProject.runtimeVersion ?? "?"})` : "не найден"}`,
		tool("1C:EDT CLI", context.tools.edtCli),
		tool("ibcmd", context.tools.ibcmd),
		tool("1cv8 (Конфигуратор)", context.tools.designer),
		tool("1cv8c (тонкий клиент)", context.tools.thinClient),
	].join("\n");
}

function stepsResult(result: StepResult[] | string): AgentToolResult<unknown> {
	if (typeof result === "string") {
		return { content: [{ type: "text", text: result }], isError: true, details: undefined };
	}
	const failed = result.some((step) => !step.ok);
	return { content: [{ type: "text", text: formatSteps(result) }], isError: failed, details: result };
}

export function registerInfobaseTools(
	pi: ExtensionAPI,
	projectRoot?: string,
	runner: ProcessRunner = runProcess,
): void {
	// Регистрирует инструмент 1c_ib для сборки, проверки и запуска информационной базы проекта.
	pi.registerTool({
		name: "1c_ib",
		label: "1C Infobase",
		description:
			"Информационная база проекта: status, build (EDT → XML через 1cedtcli → загрузка в базу через ibcmd или Конфигуратор → обновление БД; " +
			"ошибки платформы возвращаются с путями src/…:строка), update, check (/CheckConfig: синтаксис модулей, ссылки, обработчики), run (открыть базу в клиенте 1С). " +
			"База берётся из .v8-project.json (по id/алиасу, ветке Git, default) или build/ib.",
		promptSnippet:
			"1c_ib: база 1С — status, build (сборка EDT в базу), update, check (проверка платформой), run (запуск клиента)",
		parameters: IB_SCHEMA,
		execute: async (
			_toolCallId: string,
			params: IbParams,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const workspaceRoot = ctx?.cwd || projectRoot || process.cwd();
			const infobase = resolveInfobase(workspaceRoot, params.database);
			if (typeof infobase === "string") {
				return { content: [{ type: "text", text: infobase }], isError: true, details: undefined };
			}
			const context: IbContext = {
				workspaceRoot,
				edtProject: resolveEdtProject(workspaceRoot),
				infobase,
				tools: locatePlatformTools(infobase.v8path),
				run: runner,
				signal,
			};
			switch (params.action) {
				case "status":
					return { content: [{ type: "text", text: describeStatus(context) }], details: undefined };
				case "build":
					return stepsResult(await buildInfobase(context));
				case "update":
					return stepsResult(await updateDatabase(context));
				case "check":
					return stepsResult(await checkConfiguration(context));
				case "run":
					return { content: [{ type: "text", text: launchClient(context, params) }], details: undefined };
			}
		},
	});
}
