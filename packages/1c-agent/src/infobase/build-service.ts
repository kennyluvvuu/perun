// Сценарии работы с базой: сборка EDT-проекта в базу, обновление конфигурации БД, проверка платформой и запуск клиента.

import * as fs from "node:fs";
import * as path from "node:path";
import type { EdtProject } from "../edt/types.ts";
import {
	designerCheckCommand,
	designerCreateCommand,
	designerLoadCommand,
	designerUpdateCommand,
	displayCommand,
	edtExportCommand,
	enterpriseCommand,
	ibcmdApplyCommand,
	ibcmdCreateCommand,
	ibcmdImportCommand,
	type LaunchOptions,
} from "./commands.ts";
import { outputTail, parsePlatformOutput } from "./output-parser.ts";
import { launchDetached } from "./process-runner.ts";
import type { CommandSpec, PlatformTools, ProcessRunner, ResolvedInfobase, StepResult } from "./types.ts";

export interface IbContext {
	readonly workspaceRoot: string;
	readonly edtProject?: EdtProject;
	readonly infobase: ResolvedInfobase;
	readonly tools: PlatformTools;
	readonly run: ProcessRunner;
	readonly signal?: AbortSignal;
}

function workDir(context: IbContext, name: string): string {
	return path.join(context.workspaceRoot, "build", "perun", name);
}

async function execute(context: IbContext, spec: CommandSpec): Promise<StepResult> {
	fs.mkdirSync(workDir(context, "ibcmd-data"), { recursive: true });
	const outcome = await context.run(spec, context.workspaceRoot, context.signal);
	const output = [outcome.stdout, outcome.stderr, outcome.error ?? ""].join("\n");
	const issues = parsePlatformOutput(output);
	const ok = outcome.exitCode === 0 && !outcome.error;
	return {
		title: spec.title,
		commandLine: displayCommand(spec),
		ok,
		exitCode: outcome.exitCode,
		issues,
		tail: outputTail(output),
	};
}

async function sequence(context: IbContext, specs: readonly CommandSpec[]): Promise<StepResult[]> {
	const results: StepResult[] = [];
	for (const spec of specs) {
		const result = await execute(context, spec);
		results.push(result);
		if (!result.ok) break;
	}
	return results;
}

function loadSpecs(context: IbContext, xmlDir: string): CommandSpec[] | string {
	const { target } = context.infobase;
	const { ibcmd, designer } = context.tools;
	const log = workDir(context, "designer.log");
	const exists = target.type === "server" || fs.existsSync(path.join(target.path, "1Cv8.1CD"));
	if (target.type === "file" && ibcmd) {
		const data = workDir(context, "ibcmd-data");
		return exists
			? [ibcmdImportCommand(ibcmd, data, target, xmlDir), ibcmdApplyCommand(ibcmd, data, target)]
			: [ibcmdCreateCommand(ibcmd, data, target, xmlDir)];
	}
	if (designer) {
		return [
			...(exists ? [] : [designerCreateCommand(designer, target, log)]),
			designerLoadCommand(designer, target, log, xmlDir),
			designerUpdateCommand(designer, target, log),
		];
	}
	return "не найдена платформа 1С (ни ibcmd, ни 1cv8): укажите v8path в .v8-project.json или ONEC_PATH / IBCMD_PATH";
}

export async function buildInfobase(context: IbContext): Promise<StepResult[] | string> {
	// Выгружает EDT-проект в XML и загружает его в базу с обновлением конфигурации БД.
	if (!context.edtProject) {
		return "EDT-проект не найден: ожидается каталог с src/Configuration/Configuration.mdo";
	}
	if (!context.tools.edtCli) {
		return "не найден 1C:EDT CLI (1cedtcli): установите 1C:EDT или укажите путь в EDTCLI_PATH — без него проект EDT нельзя выгрузить в XML для загрузки в базу";
	}
	const xmlDir = workDir(context, "xml");
	const specs = loadSpecs(context, xmlDir);
	if (typeof specs === "string") {
		return specs;
	}
	fs.rmSync(xmlDir, { recursive: true, force: true });
	fs.mkdirSync(xmlDir, { recursive: true });
	if (context.infobase.target.type === "file") {
		fs.mkdirSync(path.dirname(context.infobase.target.path), { recursive: true });
	}
	const exportSpec = edtExportCommand(
		context.tools.edtCli,
		workDir(context, "edt-workspace"),
		context.edtProject.root,
		xmlDir,
	);
	return sequence(context, [exportSpec, ...specs]);
}

export async function updateDatabase(context: IbContext): Promise<StepResult[] | string> {
	const { target } = context.infobase;
	const { ibcmd, designer } = context.tools;
	if (target.type === "file" && ibcmd) {
		return sequence(context, [ibcmdApplyCommand(ibcmd, workDir(context, "ibcmd-data"), target)]);
	}
	if (designer) {
		return sequence(context, [designerUpdateCommand(designer, target, workDir(context, "designer.log"))]);
	}
	return "не найдена платформа 1С (ни ibcmd, ни 1cv8)";
}

export async function checkConfiguration(context: IbContext): Promise<StepResult[] | string> {
	if (!context.tools.designer) {
		return "для проверки конфигурации платформой нужен 1cv8 (Конфигуратор): укажите v8path или ONEC_PATH";
	}
	return sequence(context, [
		designerCheckCommand(context.tools.designer, context.infobase.target, workDir(context, "check.log")),
	]);
}

export function launchClient(context: IbContext, launch: LaunchOptions): string {
	const binary = context.tools.thinClient ?? context.tools.designer;
	if (!binary) {
		return "не найден клиент 1С (1cv8c / 1cv8)";
	}
	const spec = enterpriseCommand(binary, context.infobase.target, context.infobase.extraArgs, launch);
	const started = launchDetached(spec, context.workspaceRoot);
	return started.error
		? `не удалось запустить клиент: ${started.error}`
		: `Клиент 1С запущен (pid ${started.pid ?? "?"}): ${displayCommand(spec)}`;
}

export function formatSteps(steps: readonly StepResult[]): string {
	return steps
		.map((step) => {
			const header = `${step.ok ? "OK" : "ОШИБКА"} — ${step.title} (код ${step.exitCode ?? "—"})`;
			const issues = step.issues
				.slice(0, 40)
				.map((issue) =>
					`  ${issue.severity === "error" ? "ошибка" : "предупр."} ${issue.location} ${issue.message}`.trimEnd(),
				);
			const details =
				!step.ok && issues.length === 0
					? [`  ${step.commandLine}`, ...step.tail.split("\n").map((line) => `  ${line}`)]
					: [];
			return [header, ...issues, ...details].join("\n");
		})
		.join("\n");
}
