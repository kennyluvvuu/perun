// Слэш-команды и сочетания клавиш ПерУН: /mode, /doctor, /docgen и циклическое переключение режимов alt+m.

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { runDoctor } from "../doctor/index.ts";
import { generateDocsForDiff } from "../git/index.ts";
import type { ModeManager } from "../modes/index.ts";
import type { AgentMode } from "../types.ts";

const MODES = new Set<string>(["find", "explain", "write", "plan"]);

function isAgentMode(value: string): value is AgentMode {
	return MODES.has(value);
}

export function registerCommands(pi: ExtensionAPI, modeManager: ModeManager, projectRoot: string): void {
	// Регистрирует команды управления режимом, диагностики тулчейна и генерации BSLDoc.
	pi.registerCommand("mode", {
		description: "Управление режимом агента 1С: /mode [find | explain | write | plan]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const requested = args.trim().toLowerCase();
			if (isAgentMode(requested)) {
				modeManager.setMode(requested, ctx);
				ctx.ui.notify(`Режим агента 1С: ${modeManager.getConfig().title}`, "info");
			} else {
				const next = modeManager.cycleMode(ctx);
				ctx.ui.notify(`Текущий режим 1С: ${modeManager.getConfig().title} (${next})`, "info");
			}
		},
	});
	pi.registerCommand("doctor", {
		description: "Диагностика тулчейна 1С и проверка наличия необходимых инструментов",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			const result = await runDoctor();
			ctx.ui.notify(result.output, result.exitCode === 0 ? "info" : "warning");
		},
	});
	pi.registerCommand("docgen", {
		description: "Генерация и синхронизация BSLDoc по стандарту ИТС на основе Git diff: /docgen [ref] [--apply]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const applyChanges = parts.some((part) => part === "--apply" || part === "-a");
			const targetRef = parts.find((part) => !part.startsWith("-")) ?? "HEAD~1";
			ctx.ui.notify(`Анализ Git diff (${targetRef}) и генерация BSLDoc...`, "info");
			const result = await generateDocsForDiff(targetRef, undefined, projectRoot, applyChanges);
			ctx.ui.notify(result.summary, "info");
		},
	});
	try {
		pi.registerShortcut("alt+m", {
			description: "Циклическое переключение режимов 1С (НАЙТИ -> ОБЪЯСНИТЬ -> НАПИСАТЬ -> ПЛАНИРОВАТЬ)",
			handler: (ctx: ExtensionContext) => {
				modeManager.cycleMode(ctx);
			},
		});
	} catch {
		return;
	}
}
