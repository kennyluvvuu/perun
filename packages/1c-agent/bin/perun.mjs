#!/usr/bin/env node
import { setupCli } from "../../coding-agent/src/cli/setup.ts";
import { main } from "../../coding-agent/src/main.ts";
import { createOnecAgentExtension } from "../src/index.ts";

export async function runPerun(args: string[] = process.argv.slice(2)): Promise<void> {
	setupCli();
	process.title = "perun";
	const extension = createOnecAgentExtension();
	await main(args, {
		extensionFactories: [extension],
	});
}

runPerun();
