// Слэш-команда /docs: статус, синхронизация, поиск и запуск дописывания документации агентом.
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { formatHits, formatStatus, formatSyncReport } from "./docs-format.ts";
import type { DocsService } from "./docs-service.ts";

const USAGE = "Использование: /docs [status | sync | find <запрос> | update [N]]";

function updatePrompt(service: DocsService, limit: number): string | undefined {
	const items = service.outdated(limit);
	if (items.length === 0) {
		return undefined;
	}
	const list = items.map((item) => `- ${item.id} (${item.reason})`).join("\n");
	return [
		"Обнови единую документацию ПерУН для записей ниже (новые и измененные без описания, устаревшие описания).",
		"Для каждой: прочитай текущее описание через 1c_docs_read, разбери код (1c_ast_symbols, read), затем сохрани",
		"актуальное описание через 1c_docs_write: summary, при необходимости details и cases (частные случаи).",
		"Код не меняй. В конце коротко перечисли, что обновлено.",
		"",
		list,
	].join("\n");
}

export function registerDocsCommand(pi: ExtensionAPI, service: DocsService): void {
	// Регистрирует /docs для TUI и для плагина (через prompt).
	pi.registerCommand("docs", {
		description: "Единая документация проекта: /docs [status | sync | find <запрос> | update [N]]",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const [action = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);
			try {
				if (action === "status") {
					service.refresh();
					ctx.ui.notify(formatStatus(service.status()), "info");
				} else if (action === "sync") {
					ctx.ui.notify("Синхронизация документации с git...", "info");
					ctx.ui.notify(formatSyncReport(await service.sync()), "info");
				} else if (action === "find" && rest.length > 0) {
					const query = rest.join(" ");
					ctx.ui.notify(formatHits(query, service.search(query, undefined, 15)), "info");
				} else if (action === "update") {
					await service.sync();
					const limit = Math.min(Math.max(Number.parseInt(rest[0] ?? "20", 10) || 20, 1), 100);
					const prompt = updatePrompt(service, limit);
					if (prompt) {
						pi.sendUserMessage(prompt, { deliverAs: "followUp" });
					} else {
						ctx.ui.notify("Документация актуальна: дописывать нечего.", "info");
					}
				} else {
					ctx.ui.notify(USAGE, "warning");
				}
			} catch (error) {
				ctx.ui.notify(`Документация: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});
}
