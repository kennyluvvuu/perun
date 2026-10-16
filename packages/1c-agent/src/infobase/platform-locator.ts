// Поиск утилит: 1cv8 (Конфигуратор), ibcmd, 1cv8c (тонкий клиент) и 1C:EDT CLI (1cedtcli) на текущей ОС.

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { compareVersionStrings, defaultToolchainResolver, type ToolchainResolver } from "../toolchain/resolver.ts";
import type { PlatformTools } from "./types.ts";

const EXE = process.platform === "win32" ? ".exe" : "";

function existing(candidate: string | undefined): string | undefined {
	return candidate && fs.existsSync(candidate) ? candidate : undefined;
}

function which(binary: string): string | undefined {
	try {
		const output = execFileSync(process.platform === "win32" ? "where" : "which", [binary], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		});
		return existing(output.split(/\r?\n/)[0]?.trim());
	} catch {
		return undefined;
	}
}

function platformDir(v8path: string | undefined, resolver: ToolchainResolver): string | undefined {
	if (v8path) {
		const resolved = fs.existsSync(v8path) && fs.statSync(v8path).isFile() ? path.dirname(v8path) : v8path;
		if (fs.existsSync(resolved)) {
			return resolved;
		}
	}
	const designer = resolver.resolveOnecEnterprise();
	return designer ? path.dirname(designer) : undefined;
}

function edtComponentRoots(): string[] {
	if (process.platform === "win32") {
		const base = process.env.ProgramW6432 ?? process.env.ProgramFiles ?? "C:\\Program Files";
		return [path.join(base, "1C", "1CE", "components")];
	}
	if (process.platform === "darwin") {
		return [
			"/Applications/1C/1CE/components",
			path.join(process.env.HOME ?? "", "Applications", "1C", "1CE", "components"),
		];
	}
	return ["/opt/1C/1CE/components", path.join(process.env.HOME ?? "", "1C", "1CE", "components")];
}

export function locateEdtCli(): string | undefined {
	const fromEnv = existing(process.env.EDTCLI_PATH) ?? existing(process.env.EDT_CLI_PATH);
	if (fromEnv) {
		return fromEnv;
	}
	for (const root of edtComponentRoots()) {
		let entries: string[];
		try {
			entries = fs.readdirSync(root).filter((name) => name.startsWith("1c-edt-"));
		} catch {
			continue;
		}
		entries.sort((left, right) => compareVersionStrings(right, left));
		for (const entry of entries) {
			const candidate =
				existing(path.join(root, entry, `1cedtcli${EXE}`)) ??
				existing(path.join(root, entry, "1cedtcli.sh")) ??
				existing(path.join(root, entry, "1cedtcli.app", "Contents", "MacOS", "1cedtcli"));
			if (candidate) {
				return candidate;
			}
		}
	}
	return which("1cedtcli");
}

export function locatePlatformTools(
	v8path?: string,
	resolver: ToolchainResolver = defaultToolchainResolver,
): PlatformTools {
	// Находит утилиты платформы (с учётом v8path из реестра баз) и EDT CLI.
	const dir = platformDir(v8path, resolver);
	const inDir = (name: string): string | undefined => (dir ? existing(path.join(dir, `${name}${EXE}`)) : undefined);
	return {
		designer: inDir("1cv8") ?? inDir("1cv8t") ?? resolver.resolveOnecEnterprise(),
		ibcmd: inDir("ibcmd") ?? resolver.resolveIbcmd(),
		thinClient: inDir("1cv8c") ?? inDir("1cv8ct"),
		edtCli: locateEdtCli(),
	};
}

export function locateXvfbRun(): string | undefined {
	return process.platform === "linux" && !process.env.DISPLAY ? which("xvfb-run") : undefined;
}
