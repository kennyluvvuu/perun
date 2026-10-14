import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { runVanessaCommand } from "./runner.ts";
import type { VanessaCommandExecutor, VanessaToolOptions } from "./types.ts";

export function registerVanessaTools(pi: ExtensionAPI, projectRoot?: string, executor?: VanessaCommandExecutor): void {
	pi.registerTool({
		name: "1c_vanessa",
		label: "1C Vanessa Tools",
		description:
			"Управление информационной базой 1С и BDD-тестированием через Vanessa Tools (vrunner 3.x + Vanessa Automation). " +
			"Операции: 'init-dev'/'infobase-init' (создание dev-базы), 'load'/'cf-load' (загрузка исходников XML/EDT), " +
			"'dump'/'cf-decompile' (выгрузка в файлы), 'updatedb'/'infobase-update' (применение изменений в БД), " +
			"'test'/'test-vanessa' (запуск BDD feature-сценариев через Vanessa Automation).",
		promptSnippet:
			"1c_vanessa: пакетное управление ИБ и BDD-тесты через Vanessa Tools (init-dev, load, dump, updatedb, test)",
		parameters: Type.Object({
			action: Type.Union(
				[
					Type.Literal("init-dev"),
					Type.Literal("infobase-init"),
					Type.Literal("load"),
					Type.Literal("cf-load"),
					Type.Literal("dump"),
					Type.Literal("cf-dump"),
					Type.Literal("cf-decompile"),
					Type.Literal("updatedb"),
					Type.Literal("infobase-update"),
					Type.Literal("test"),
					Type.Literal("test-vanessa"),
				],
				{
					description:
						"Действие: 'init-dev'/'infobase-init' (создать ИБ), 'load'/'cf-load' (загрузить исходники), 'dump'/'cf-decompile' (выгрузить в файлы), 'updatedb'/'infobase-update' (обновить конфигурацию БД), 'test'/'test-vanessa' (запустить BDD-тесты).",
				},
			),
			src: Type.Optional(
				Type.String({
					description: "Путь к каталогу исходников конфигурации XML/EDT (для init-dev, load, dump).",
				}),
			),
			ibconnection: Type.Optional(
				Type.String({
					description: "Строка подключения к информационной базе (например, /F./build/ib или File='...').",
				}),
			),
			features: Type.Optional(
				Type.String({
					description: "Путь к каталогу или файлу сценариев тестов .feature (для action: 'test').",
				}),
			),
			vanessaPath: Type.Optional(
				Type.String({
					description:
						"Путь к внешней обработке vanessa-automation.epf (опционально, определяется автоматически).",
				}),
			),
			vrunnerPath: Type.Optional(
				Type.String({
					description: "Путь к бинарнику или скрипту vrunner (опционально, определяется автоматически).",
				}),
			),
			v8version: Type.Optional(
				Type.String({
					description: "Версия платформы 1С:Предприятие (например, 8.3.25 или 8.3.25.1234).",
				}),
			),
			onecPath: Type.Optional(
				Type.String({
					description: "Явный путь к исполняемому файлу платформы 1С:Предприятие (1cv8 / 1cv8t).",
				}),
			),
			ibcmd: Type.Optional(
				Type.Boolean({
					description: "Использовать утилиту ibcmd вместо Конфигуратора для операций с ИБ.",
				}),
			),
			dbUser: Type.Optional(
				Type.String({
					description: "Имя пользователя информационной базы.",
				}),
			),
			dbPassword: Type.Optional(
				Type.String({
					description: "Пароль пользователя информационной базы.",
				}),
			),
			settings: Type.Optional(
				Type.String({
					description: "Путь к файлу настроек vrunner.json или autumn-properties.json.",
				}),
			),
			additionalArgs: Type.Optional(
				Type.Array(Type.String(), {
					description: "Дополнительные аргументы командной строки vrunner.",
				}),
			),
		}),
		execute: async (
			_toolCallId: string,
			params: VanessaToolOptions,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const effectiveRoot = ctx?.cwd || projectRoot || process.cwd();
			const result = await runVanessaCommand(params, {
				projectRoot: effectiveRoot,
				signal,
				executor,
			});

			const lines: string[] = [
				`[Vanessa Tools: ${params.action.toUpperCase()}]`,
				`Статус: ${result.success ? "УСПЕШНО" : "ОШИБКА"}`,
				`Команда: ${result.command} ${result.args.join(" ")}`,
				`код возврата: ${result.exitCode !== null ? result.exitCode : "прервано/сигнал"}`,
			];

			if (result.stdout.trim()) {
				lines.push("\n--- Стандартный вывод ---");
				lines.push(result.stdout.trim());
			}

			if (result.stderr.trim()) {
				lines.push("\n--- Ошибки ---");
				lines.push(result.stderr.trim());
			}

			if (result.error && !result.stderr.includes(result.error)) {
				lines.push(`\nОшибка: ${result.error}`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				isError: !result.success,
				details: result,
			};
		},
	});
}
