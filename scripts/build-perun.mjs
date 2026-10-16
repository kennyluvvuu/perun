#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = dirname(fileURLToPath(import.meta.url));
let repoRoot = resolve(scriptDir, "..");
const onecAgentDir = join(repoRoot, "packages", "1c-agent");
const pkgJsonPath = join(onecAgentDir, "package.json");
const onecPkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
const outputFile = join(onecAgentDir, "bin", "perun.bundle.mjs");

const banner = {
	js: 'import { createRequire as __piCreateRequire } from "node:module"; const require = __piCreateRequire(import.meta.url);',
};

console.log("Building PerUN (ПерУН — Персональный Умный Напарник для 1С)...");

try {
	const result = await build({
		absWorkingDir: repoRoot,
		entryPoints: [join(onecAgentDir, "src", "cli.ts")],
		write: false,
		bundle: true,
		format: "esm",
		platform: "node",
		target: "node22.19",
		banner,
		define: {
			PI_BUNDLED_NODE: "true",
			"process.env.APP_NAME": '"perun"',
			"process.env.APP_VERSION": JSON.stringify(onecPkg.version),
		},
		external: [
			"@silvia-odwyer/photon-node",
			"jiti",
			"bufferutil",
			"utf-8-validate",
			"kerberos",
			"supports-color",
		],
		minifySyntax: true,
		minifyWhitespace: false,
		sourcemap: false,
		logLevel: "warning",
	});

	if (result.outputFiles && result.outputFiles.length > 0) {
		const binDir = join(onecAgentDir, "bin");
		mkdirSync(binDir, { recursive: true });

		if (existsSync(outputFile)) {
			try {
				unlinkSync(outputFile);
			} catch {}
		}
		writeFileSync(outputFile, result.outputFiles[0].contents);
		try {
			chmodSync(outputFile, 0o755);
		} catch {}
		console.log(`PerUN ESM бандл готов: ${outputFile} (${(result.outputFiles[0].contents.byteLength / 1024 / 1024).toFixed(2)} MB)`);

		// Copy runtime assets next to the binary
		const themeSrcDir = join(repoRoot, "packages", "coding-agent", "src", "modes", "interactive", "theme");
		const themeDestDir = join(binDir, "theme");
		mkdirSync(themeDestDir, { recursive: true });
		for (const file of readdirSync(themeSrcDir)) {
			if (file.endsWith(".json")) {
				copyFileSync(join(themeSrcDir, file), join(themeDestDir, file));
			}
		}

		const exportHtmlSrcDir = join(repoRoot, "packages", "coding-agent", "src", "core", "export-html");
		const exportHtmlDestDir = join(binDir, "export-html");
		cpSync(exportHtmlSrcDir, exportHtmlDestDir, { recursive: true });

		const assetsSrcDir = join(repoRoot, "packages", "coding-agent", "src", "modes", "interactive", "assets");
		const assetsDestDir = join(binDir, "assets");
		cpSync(assetsSrcDir, assetsDestDir, { recursive: true });

		// Copy tools directory into bin
		const toolsSrcDir = join(onecAgentDir, "tools");
		const toolsDestDir = join(binDir, "tools");
		if (existsSync(toolsSrcDir)) {
			cpSync(toolsSrcDir, toolsDestDir, { recursive: true });
			const bslBinary = join(toolsDestDir, "bsl-analyzer");
			if (existsSync(bslBinary)) {
				try {
					chmodSync(bslBinary, 0o755);
				} catch {}
			}
		}

		// Copy package.json next to the binary for runtime metadata
		copyFileSync(pkgJsonPath, join(binDir, "package.json"));

		// Bun native binary compilation
		const bunCandidate = process.env.BUN_PATH || (existsSync(join(homedir(), ".bun", "bin", "bun")) ? join(homedir(), ".bun", "bin", "bun") : "bun");
		const bunBinaryOutput = join(onecAgentDir, "bin", "perun");

		if (existsSync(bunBinaryOutput)) {
			try {
				unlinkSync(bunBinaryOutput);
			} catch {}
		}
		console.log("Компиляция в нативный бинарник с помощью Bun...");
		const bunProc = spawnSync(
			bunCandidate,
			[
				"build",
				"--compile",
				"--define",
				'process.env.APP_NAME="perun"',
				"--define",
				`process.env.APP_VERSION="${onecPkg.version}"`,
				"--outfile",
				bunBinaryOutput,
				outputFile,
			],
			{
				stdio: "inherit",
			},
		);
		if (bunProc.status === 0) {
			try {
				chmodSync(bunBinaryOutput, 0o755);
			} catch {}
			console.log(`Нативный бинарник PerUN успешно создан: ${bunBinaryOutput}`);
		} else {
			console.warn("Bun компиляция завершилась с ошибкой, доступен ESM бандл perun.bundle.mjs");
		}
	}
} catch (error) {
	console.error("Ошибка сборки PerUN:", error);
	process.exit(1);
}
