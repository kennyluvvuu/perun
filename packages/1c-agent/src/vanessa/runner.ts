import { spawn } from "node:child_process";
import {
	defaultToolchainResolver,
	extractOnecVersion,
	resolveOscriptPath,
	resolveVanessaAutomationPath,
	resolveVrunnerPath,
	type ToolchainResolver,
} from "../toolchain/resolver.ts";
import type { VanessaCommandExecutor, VanessaToolOptions, VanessaToolResult } from "./types.ts";

export const defaultVanessaExecutor: VanessaCommandExecutor = (
	command: string,
	args: string[],
	cwd: string,
	signal?: AbortSignal,
	env?: NodeJS.ProcessEnv,
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> => {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";

		try {
			const child = spawn(command, args, {
				cwd,
				stdio: ["ignore", "pipe", "pipe"],
				signal,
				shell: process.platform === "win32",
				env: env || process.env,
			});

			child.stdout?.on("data", (data: Buffer) => {
				stdout += data.toString("utf8");
			});

			child.stderr?.on("data", (data: Buffer) => {
				stderr += data.toString("utf8");
			});

			child.on("error", (err: Error) => {
				const notFound = (err as { code?: string }).code === "ENOENT";
				const errMsg = notFound
					? `Утилита '${command}' не найдена в $PATH. Убедитесь, что она установлена и доступна в $PATH.`
					: err.message;
				resolve({
					stdout,
					stderr: stderr ? `${stderr}\n${errMsg}` : errMsg,
					exitCode: 1,
				});
			});

			child.on("close", (exitCode: number | null) => {
				resolve({
					stdout,
					stderr,
					exitCode,
				});
			});
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			resolve({
				stdout: "",
				stderr: message,
				exitCode: 1,
			});
		}
	});
};

export function buildVanessaArgs(
	options: VanessaToolOptions,
	projectRoot?: string,
	resolver: ToolchainResolver = defaultToolchainResolver,
): { command: string; args: string[] } {
	const rawCommand = resolveVrunnerPath(options.vrunnerPath) || options.vrunnerPath || "vrunner";
	const args: string[] = [];
	let trailingPositional: string | undefined;

	switch (options.action) {
		case "init-dev":
		case "infobase-init":
			args.push("infobase", "init");
			if (options.src) args.push("--src", options.src);
			if (options.ibconnection) args.push("--ibconnection", options.ibconnection);
			if (options.settings) args.push("--settings", options.settings);
			if (options.dbUser) args.push("--db-user", options.dbUser);
			if (options.dbPassword) args.push("--db-pwd", options.dbPassword);
			break;

		case "load":
		case "cf-load":
			args.push("cf", "load");
			if (options.ibconnection) args.push("--ibconnection", options.ibconnection);
			if (options.settings) args.push("--settings", options.settings);
			if (options.dbUser) args.push("--db-user", options.dbUser);
			if (options.dbPassword) args.push("--db-pwd", options.dbPassword);
			if (options.src) trailingPositional = options.src;
			break;

		case "dump":
		case "cf-dump":
		case "cf-decompile":
			args.push("cf", "decompile");
			if (options.ibconnection) args.push("--ibconnection", options.ibconnection);
			if (options.settings) args.push("--settings", options.settings);
			if (options.dbUser) args.push("--db-user", options.dbUser);
			if (options.dbPassword) args.push("--db-pwd", options.dbPassword);
			if (options.src) trailingPositional = options.src;
			break;

		case "updatedb":
		case "infobase-update":
			args.push("infobase", "update");
			if (options.src) args.push("--src", options.src);
			if (options.ibconnection) args.push("--ibconnection", options.ibconnection);
			if (options.settings) args.push("--settings", options.settings);
			if (options.dbUser) args.push("--db-user", options.dbUser);
			if (options.dbPassword) args.push("--db-pwd", options.dbPassword);
			break;

		case "test":
		case "test-vanessa": {
			args.push("test", "vanessa");
			if (options.features) args.push("--feature-path", options.features);
			const vanessaEpf = resolveVanessaAutomationPath(options.vanessaPath, projectRoot);
			if (vanessaEpf) {
				args.push("--bddrunner-path", vanessaEpf);
			}
			if (options.ibconnection) args.push("--ibconnection", options.ibconnection);
			if (options.settings) args.push("--settings", options.settings);
			if (options.dbUser) args.push("--db-user", options.dbUser);
			if (options.dbPassword) args.push("--db-pwd", options.dbPassword);
			break;
		}
	}

	const hasAdditionalV8version = options.additionalArgs?.includes("--v8version");
	const hasAdditionalIbcmd = options.additionalArgs?.includes("--ibcmd");

	if (options.ibcmd && !args.includes("--ibcmd") && !hasAdditionalIbcmd) {
		args.push("--ibcmd");
	}

	if (options.v8version && !args.includes("--v8version") && !hasAdditionalV8version) {
		args.push("--v8version", options.v8version);
	} else if (process.platform === "darwin" && !args.includes("--v8version") && !hasAdditionalV8version) {
		const onec = options.onecPath || resolver.resolveOnecEnterprise();
		if (onec) {
			const extracted = extractOnecVersion(onec);
			if (extracted) {
				args.push("--v8version", extracted);
			} else if (onec.includes("1cv8t") && !args.includes("--ibcmd") && !hasAdditionalIbcmd) {
				args.push("--ibcmd");
			}
		}
	}

	if (options.additionalArgs && options.additionalArgs.length > 0) {
		args.push(...options.additionalArgs);
	}

	if (trailingPositional) {
		args.push(trailingPositional);
	}

	if (rawCommand.endsWith(".os")) {
		const oscript = resolveOscriptPath() || "oscript";
		return { command: oscript, args: [rawCommand, ...args] };
	}

	return { command: rawCommand, args };
}

export interface RunVanessaContext {
	projectRoot?: string;
	signal?: AbortSignal;
	executor?: VanessaCommandExecutor;
	resolver?: ToolchainResolver;
}

export async function runVanessaCommand(
	options: VanessaToolOptions,
	context: RunVanessaContext = {},
): Promise<VanessaToolResult> {
	const resolver = context.resolver || defaultToolchainResolver;

	if (!context.executor) {
		const vrunner = resolveVrunnerPath(options.vrunnerPath);
		if (!vrunner) {
			return {
				success: false,
				action: options.action,
				command: "vrunner",
				args: [],
				stdout: "",
				stderr:
					"Утилита 'vrunner' (Vanessa Runner) не найдена в $PATH. Установите OneScript и vrunner (например, 'opm install vrunner') или укажите точный путь через переменную окружения VRUNNER_PATH.",
				exitCode: 1,
				error: "Утилита 'vrunner' (Vanessa Runner) не найдена в $PATH. Установите OneScript и vrunner (например, 'opm install vrunner') или укажите точный путь через переменную окружения VRUNNER_PATH.",
			};
		}
	}

	const cwd = context.projectRoot || process.cwd();
	const { command, args } = buildVanessaArgs(options, cwd, resolver);

	if (!context.executor && command.endsWith(".os")) {
		const oscript = resolveOscriptPath();
		if (!oscript) {
			return {
				success: false,
				action: options.action,
				command: "oscript",
				args,
				stdout: "",
				stderr:
					"Интерпретатор OneScript ('oscript') не найден в $PATH для запуска скрипта vrunner.os. Установите OneScript или укажите путь через переменную окружения OSCRIPT_PATH.",
				exitCode: 1,
				error: "Интерпретатор OneScript ('oscript') не найден в $PATH для запуска скрипта vrunner.os. Установите OneScript или укажите путь через переменную окружения OSCRIPT_PATH.",
			};
		}
	}

	const env: NodeJS.ProcessEnv = { ...process.env };
	const resolvedOnec = options.onecPath || resolver.resolveOnecEnterprise();
	if (resolvedOnec) {
		env.VRUNNER_V8PATH = resolvedOnec;
		const ver = options.v8version || extractOnecVersion(resolvedOnec);
		if (ver) {
			env.VRUNNER_V8VERSION = ver;
		}
	}

	const executor = context.executor || defaultVanessaExecutor;
	const execResult = await executor(command, args, cwd, context.signal, env);
	const success = execResult.exitCode === 0;

	return {
		success,
		action: options.action,
		command,
		args,
		stdout: execResult.stdout,
		stderr: execResult.stderr,
		exitCode: execResult.exitCode,
		error: success
			? undefined
			: execResult.stderr ||
				`Команда завершилась с кодом ${execResult.exitCode !== null ? execResult.exitCode : "прервано/сигнал"}`,
	};
}
