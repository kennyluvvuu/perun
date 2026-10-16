// Построение командных строк: выгрузка EDT в XML, загрузка в базу через ibcmd или Конфигуратор, проверка и запуск клиента.

import type { CommandSpec, InfobaseTarget } from "./types.ts";

const HOUR = 60 * 60 * 1000;

export interface LaunchOptions {
	readonly execute?: string;
	readonly startupParameter?: string;
	readonly url?: string;
}

function ibcmdConnection(dataDir: string, target: InfobaseTarget): string[] {
	if (target.type !== "file") {
		throw new Error("ibcmd используется только для файловых баз; для серверной базы нужен Конфигуратор");
	}
	return ["infobase", "--data", dataDir, "--db-path", target.path];
}

function ibcmdAuth(target: InfobaseTarget): string[] {
	return [
		...(target.user ? ["--user", target.user] : []),
		...(target.password ? ["--password", target.password] : []),
	];
}

function v8Connection(target: InfobaseTarget): string[] {
	const address = target.type === "file" ? ["/F", target.path] : ["/S", `${target.server}\\${target.ref}`];
	return [
		...address,
		...(target.user ? ["/N", target.user] : []),
		...(target.password ? ["/P", target.password] : []),
	];
}

export function edtExportCommand(edtCli: string, workspace: string, projectDir: string, xmlDir: string): CommandSpec {
	// Команда 1cedtcli для выгрузки EDT-проекта в XML-файлы конфигурации.
	return {
		title: "Выгрузка EDT-проекта в XML (1cedtcli export)",
		command: edtCli,
		args: ["-data", workspace, "-command", "export", "--project", projectDir, "--configuration-files", xmlDir],
		timeoutMs: HOUR,
	};
}

export function ibcmdCreateCommand(
	ibcmd: string,
	dataDir: string,
	target: InfobaseTarget,
	xmlDir: string,
): CommandSpec {
	return {
		title: "Создание файловой базы с конфигурацией (ibcmd infobase create --import --apply)",
		command: ibcmd,
		args: [
			...ibcmdConnection(dataDir, target),
			"create",
			...ibcmdAuth(target),
			`--import=${xmlDir}`,
			"--apply",
			"--force",
		],
		timeoutMs: HOUR,
	};
}

export function ibcmdImportCommand(
	ibcmd: string,
	dataDir: string,
	target: InfobaseTarget,
	xmlDir: string,
): CommandSpec {
	return {
		title: "Загрузка конфигурации из XML (ibcmd config import)",
		command: ibcmd,
		args: [...ibcmdConnection(dataDir, target), "config", "import", ...ibcmdAuth(target), xmlDir],
		timeoutMs: HOUR,
	};
}

export function ibcmdApplyCommand(ibcmd: string, dataDir: string, target: InfobaseTarget): CommandSpec {
	return {
		title: "Обновление конфигурации базы данных (ibcmd config apply)",
		command: ibcmd,
		args: [...ibcmdConnection(dataDir, target), "config", "apply", ...ibcmdAuth(target), "--force"],
		timeoutMs: HOUR,
	};
}

function designer(
	title: string,
	binary: string,
	target: InfobaseTarget,
	logFile: string,
	command: readonly string[],
): CommandSpec {
	return {
		title,
		command: binary,
		args: [
			"DESIGNER",
			"/DisableStartupDialogs",
			"/DisableStartupMessages",
			...v8Connection(target),
			"/Out",
			logFile,
			...command,
		],
		logFile,
		timeoutMs: HOUR,
	};
}

export function designerCreateCommand(binary: string, target: InfobaseTarget, logFile: string): CommandSpec {
	if (target.type !== "file") {
		throw new Error("создание серверной базы не поддерживается; создайте её в кластере и укажите в .v8-project.json");
	}
	return {
		title: "Создание файловой базы (CREATEINFOBASE)",
		command: binary,
		args: ["CREATEINFOBASE", `File="${target.path}"`, "/DisableStartupDialogs", "/Out", logFile],
		logFile,
		timeoutMs: HOUR,
	};
}

export function designerLoadCommand(
	binary: string,
	target: InfobaseTarget,
	logFile: string,
	xmlDir: string,
): CommandSpec {
	return designer("Загрузка конфигурации из XML (/LoadConfigFromFiles)", binary, target, logFile, [
		"/LoadConfigFromFiles",
		xmlDir,
	]);
}

export function designerUpdateCommand(binary: string, target: InfobaseTarget, logFile: string): CommandSpec {
	return designer("Обновление конфигурации базы данных (/UpdateDBCfg)", binary, target, logFile, ["/UpdateDBCfg"]);
}

export function designerCheckCommand(binary: string, target: InfobaseTarget, logFile: string): CommandSpec {
	return designer("Проверка конфигурации платформой (/CheckConfig)", binary, target, logFile, [
		"/CheckConfig",
		"-ThinClient",
		"-Server",
		"-ExternalConnection",
		"-IncorrectReferences",
		"-HandlersExistence",
		"-EmptyHandlers",
		"-ExtendedModulesCheck",
	]);
}

export function enterpriseCommand(
	binary: string,
	target: InfobaseTarget,
	extraArgs: readonly string[],
	launch: LaunchOptions,
): CommandSpec {
	return {
		title: "Запуск 1С:Предприятие",
		command: binary,
		args: [
			"ENTERPRISE",
			"/DisableStartupDialogs",
			...v8Connection(target),
			...(launch.execute ? ["/Execute", launch.execute] : []),
			...(launch.startupParameter ? ["/C", launch.startupParameter] : []),
			...(launch.url ? ["/URL", launch.url] : []),
			...extraArgs,
		],
	};
}

export function displayCommand(spec: CommandSpec): string {
	const masked = spec.args.map((arg, index) =>
		spec.args[index - 1] === "/P" || spec.args[index - 1] === "--password" ? "***" : arg,
	);
	return [spec.command, ...masked].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(" ");
}
