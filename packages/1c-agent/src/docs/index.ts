// Модуль единой документации проекта: публичный API и подключение к расширению ПерУН.
import type { ExtensionAPI, ExtensionRequestEvent } from "@earendil-works/pi-coding-agent";
import { registerDocsCommand } from "./docs-command.ts";
import { handleDocsRequest } from "./docs-rpc.ts";
import type { DocsService } from "./docs-service.ts";
import { registerDocsTools } from "./docs-tools.ts";

export * from "./bsl-outline.ts";
export * from "./docs-format.ts";
export * from "./docs-prompt.ts";
export * from "./docs-rpc.ts";
export * from "./docs-schema.ts";
export * from "./docs-service.ts";
export * from "./metadata-labels.ts";
export * from "./types.ts";

export function registerDocs(pi: ExtensionAPI, service: DocsService): void {
	// Подключает инструменты агента, команду /docs и RPC-методы docs.* для плагина.
	registerDocsTools(pi, service);
	registerDocsCommand(pi, service);
	pi.on("extension_request", (event: ExtensionRequestEvent) => handleDocsRequest(service, event.method, event.params));
}
