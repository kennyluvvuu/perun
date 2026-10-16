// Жизненный цикл сессии: запуск bsl-analyzer и документации для проекта 1С, уроки памяти, освобождение ресурсов.

import type { ExtensionAPI, ExtensionContext, SessionStartEvent } from "@earendil-works/pi-coding-agent";
import type { DocsService } from "../docs/index.ts";
import type { BslLspClient } from "../lsp/index.ts";
import { formatMemoryContext, type MemoryStore } from "../memory/index.ts";
import type { ModeManager } from "../modes/index.ts";
import type { PerunNotifyClient } from "../notify/index.ts";
import type { PermissionManager } from "../permissions/index.ts";
import type { OnecPromptSection } from "../prompt/index.ts";
import { detect1cProject } from "./project-detect.ts";

export interface SessionDependencies {
	readonly projectRoot: string;
	readonly modeManager: ModeManager;
	readonly permissionManager: PermissionManager;
	readonly lspClient: BslLspClient;
	readonly memoryStore: MemoryStore;
	readonly docsService: DocsService;
	readonly promptSection: OnecPromptSection;
	readonly notifyClient?: PerunNotifyClient;
	readonly setContext: (ctx: ExtensionContext) => void;
}

function injectLessons(pi: ExtensionAPI, deps: SessionDependencies, ctx: ExtensionContext): void {
	const lessons = deps.memoryStore.getRelevantLessons(ctx.cwd || deps.projectRoot);
	if (lessons.length === 0 || !pi.sendMessage) {
		return;
	}
	const entries = ctx.sessionManager?.getEntries ? ctx.sessionManager.getEntries() : [];
	const injected = entries.some((entry) => (entry as { customType?: string }).customType === "pi-memory-context");
	if (!injected) {
		pi.sendMessage({ customType: "pi-memory-context", content: formatMemoryContext(lessons), display: false });
	}
}

export function registerSessionLifecycle(pi: ExtensionAPI, deps: SessionDependencies): void {
	// Подписывает расширение на начало и завершение сессии агента.
	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		deps.setContext(ctx);
		deps.promptSection.invalidate();
		deps.modeManager.initializeTools();
		deps.modeManager.updateUI(ctx);
		if (ctx.cwd) {
			deps.permissionManager.getPolicy().setProjectRoot(ctx.cwd);
		}
		deps.permissionManager.updateUI(ctx);
		if (await detect1cProject(deps.projectRoot)) {
			await deps.lspClient.start(deps.projectRoot).catch(() => undefined);
			deps.docsService.setRoot(ctx.cwd || deps.projectRoot);
			deps.docsService.refresh();
		}
		injectLessons(pi, deps, ctx);
	});
	pi.on("session_shutdown", async () => {
		if (deps.notifyClient) {
			await deps.notifyClient.flush().catch(() => undefined);
		}
		await deps.lspClient.stop().catch(() => undefined);
		deps.memoryStore.close();
		deps.docsService.close();
	});
}
