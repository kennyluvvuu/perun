#!/usr/bin/env node
import * as fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setupCli } from "../../coding-agent/src/cli/setup.ts";
import { main } from "../../coding-agent/src/main.ts";
import { handleDoctorCli, type RunDoctorCliOptions } from "./doctor/index.ts";
import { createOnecAgentExtension } from "./index.ts";

export type RunPerunOptions = RunDoctorCliOptions;

export async function runPerun(args: string[] = process.argv.slice(2), options?: RunPerunOptions): Promise<void> {
	if (await handleDoctorCli(args, options)) {
		return;
	}

	const env = process.env;
	env.APP_NAME = "perun";
	if (!env.APP_VERSION) {
		try {
			const cliDir = dirname(fileURLToPath(import.meta.url));
			const candidates = [
				join(cliDir, "..", "package.json"),
				join(dirname(process.execPath), "package.json"),
				join(cliDir, "package.json"),
			];
			for (const candidate of candidates) {
				if (fs.existsSync(candidate)) {
					const pkg = JSON.parse(fs.readFileSync(candidate, "utf-8"));
					if (pkg.version) {
						env.APP_VERSION = pkg.version;
						break;
					}
				}
			}
		} catch {}
	}
	setupCli();
	process.title = "perun";
	const extensionRunner = createOnecAgentExtension();
	await main(args, {
		extensionFactories: [
			{
				name: "perun-1c",
				factory: (pi: ExtensionAPI) => {
					extensionRunner(pi);
				},
			},
		],
	});
}

// Direct CLI invocation
if (
	import.meta.url === `file://${process.argv[1]}` ||
	process.argv[1]?.endsWith("/perun") ||
	process.argv[1]?.endsWith("cli.ts")
) {
	runPerun();
}
