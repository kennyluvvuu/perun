// Запуск утилит платформы: захват вывода и лога /Out, таймаут, xvfb-run без дисплея и отсоединённый запуск клиента.

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { locateXvfbRun } from "./platform-locator.ts";
import type { CommandSpec, ProcessOutcome } from "./types.ts";

const BOM_PREFIX = new RegExp(`^${String.fromCharCode(0xfeff)}`);
const OUTPUT_LIMIT = 512 * 1024;
const NEEDS_DISPLAY = new Set(["DESIGNER", "CREATEINFOBASE"]);

function withDisplay(spec: CommandSpec): { command: string; args: string[] } {
	const xvfb = NEEDS_DISPLAY.has(spec.args[0] ?? "") ? locateXvfbRun() : undefined;
	return xvfb
		? { command: xvfb, args: ["-a", spec.command, ...spec.args] }
		: { command: spec.command, args: [...spec.args] };
}

function readLog(logFile: string | undefined): string {
	if (!logFile) {
		return "";
	}
	try {
		return fs.readFileSync(logFile, "utf8").replace(BOM_PREFIX, "");
	} catch {
		return "";
	}
}

export function runProcess(spec: CommandSpec, cwd: string, signal?: AbortSignal): Promise<ProcessOutcome> {
	// Выполняет команду и возвращает код выхода, вывод и содержимое лога /Out.
	if (spec.logFile) {
		fs.rmSync(spec.logFile, { force: true });
	}
	const { command, args } = withDisplay(spec);
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (outcome: ProcessOutcome): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const log = readLog(spec.logFile);
			resolve({ ...outcome, stdout: log ? `${outcome.stdout}\n${log}`.trim() : outcome.stdout });
		};
		const child = spawn(command, args, { cwd, signal, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
		const timer = setTimeout(
			() => {
				child.kill();
				finish({
					exitCode: null,
					stdout,
					stderr,
					error: `превышено время ожидания ${Math.round((spec.timeoutMs ?? 0) / 1000)} с`,
				});
			},
			spec.timeoutMs ?? 10 * 60 * 1000,
		);
		child.stdout.on("data", (chunk: Buffer) => {
			if (stdout.length < OUTPUT_LIMIT) stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			if (stderr.length < OUTPUT_LIMIT) stderr += chunk.toString("utf8");
		});
		child.on("error", (error: Error) => {
			const missing = (error as { code?: string }).code === "ENOENT";
			finish({
				exitCode: null,
				stdout,
				stderr,
				error: missing ? `не найден исполняемый файл ${command}` : error.message,
			});
		});
		child.on("close", (exitCode: number | null) => finish({ exitCode, stdout, stderr }));
	});
}

export function launchDetached(spec: CommandSpec, cwd: string): { readonly pid?: number; readonly error?: string } {
	const { command, args } = withDisplay(spec);
	try {
		const child = spawn(command, args, { cwd, detached: true, stdio: "ignore", windowsHide: false });
		child.on("error", () => undefined);
		child.unref();
		return { pid: child.pid };
	} catch (error: unknown) {
		return { error: error instanceof Error ? error.message : String(error) };
	}
}
