#!/usr/bin/env node
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
