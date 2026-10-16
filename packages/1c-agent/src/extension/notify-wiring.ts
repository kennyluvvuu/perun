// Подключение внешних уведомлений ПерУН (PERUN_NOTIFY_*): удалённые подтверждения и события завершения работы агента.

import * as path from "node:path";
import type { AgentEndEvent, AgentSettledEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { PerunNotifyClient } from "../notify/index.ts";
import type { PermissionManager } from "../permissions/index.ts";

export function setupNotify(
	pi: ExtensionAPI,
	permissionManager: PermissionManager,
	projectRoot: string,
	getContext: () => ExtensionContext | undefined,
): PerunNotifyClient | undefined {
	// Создаёт клиент уведомлений при заданных PERUN_NOTIFY_URL и PERUN_NOTIFY_SECRET и подписывает его на события.
	const url = process.env.PERUN_NOTIFY_URL;
	const secret = process.env.PERUN_NOTIFY_SECRET;
	if (!url || !secret) {
		return undefined;
	}
	const client = new PerunNotifyClient({
		url,
		secret,
		session: process.env.PERUN_NOTIFY_SESSION || path.basename(projectRoot),
		onError: (message) => {
			const ctx = getContext();
			if (ctx?.mode === "tui" || ctx?.mode === "rpc") {
				ctx.ui.notify(message, "warning");
			} else {
				process.stderr.write(`[Perun] ${message}\n`);
			}
		},
	});
	permissionManager.setRemoteConfirm((title, message, signal) => client.askConfirm(title, message, signal));
	pi.on("agent_end", (event: AgentEndEvent) => {
		const lastAssistant = event.messages
			?.slice()
			.reverse()
			.find((message) => (message as { role?: string })?.role === "assistant");
		client.notify({ type: "agent_end", messages: lastAssistant ? [lastAssistant] : [] });
	});
	pi.on("agent_settled", (event: AgentSettledEvent) => {
		client.notify({ type: "agent_settled", aborted: Boolean(event.aborted) });
	});
	return client;
}
