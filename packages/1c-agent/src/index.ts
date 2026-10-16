// Точка входа расширения ПерУН: собирает инструменты 1С, режимы, права, промпт, диагностику и жизненный цикл сессии.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerAutofixTools } from "./autofix/index.ts";
import { DocsService, registerDocs } from "./docs/index.ts";
import { registerMetadataTools } from "./edt/index.ts";
import { registerCommands } from "./extension/commands.ts";
import { registerFeedbackMemory } from "./extension/feedback-memory.ts";
import { registerAgentHooks } from "./extension/hooks.ts";
import { setupNotify } from "./extension/notify-wiring.ts";
import { registerSessionLifecycle } from "./extension/session.ts";
import { registerGitTools } from "./git/index.ts";
import { registerInfobaseTools } from "./infobase/index.ts";
import { BslLspClient, InlineFeedbackHandler } from "./lsp/index.ts";
import { MemoryStore } from "./memory/index.ts";
import { ModeManager } from "./modes/index.ts";
import { registerNavigatorTools } from "./navigator/index.ts";
import type { PerunNotifyClient } from "./notify/index.ts";
import { PermissionManager } from "./permissions/index.ts";
import { OnecPromptSection } from "./prompt/index.ts";
import type { AgentMode } from "./types.ts";
import { registerVanessaTools } from "./vanessa/index.ts";

export * from "./autofix/index.ts";
export * from "./docs/index.ts";
export * from "./doctor/index.ts";
export * from "./edt/index.ts";
export { detect1cProject } from "./extension/project-detect.ts";
export * from "./git/index.ts";
export * from "./infobase/index.ts";
export * from "./lsp/index.ts";
export * from "./memory/index.ts";
export * from "./modes/index.ts";
export * from "./navigator/index.ts";
export * from "./notify/index.ts";
export * from "./permissions/index.ts";
export * from "./prompt/index.ts";
export * from "./toolchain/index.ts";
export * from "./types.ts";
export * from "./vanessa/index.ts";

export interface OnecAgentExtensionOptions {
	initialMode?: AgentMode;
	bslAnalyzerPath?: string;
	projectRoot?: string;
	memoryDbPath?: string;
	docsDbPath?: string;
}

export interface OnecAgentExtensionHandle {
	modeManager: ModeManager;
	lspClient: BslLspClient;
	inlineFeedback: InlineFeedbackHandler;
	permissionManager: PermissionManager;
	notifyClient?: PerunNotifyClient;
	memoryStore: MemoryStore;
	docsService: DocsService;
}

export function createOnecAgentExtension(options: OnecAgentExtensionOptions = {}) {
	// Возвращает фабрику расширения ПерУН для pi с заданными путями и начальным режимом.
	return function onecAgentExtension(pi: ExtensionAPI): OnecAgentExtensionHandle {
		const projectRoot = options.projectRoot || process.cwd();
		const memoryStore = new MemoryStore(options.memoryDbPath);
		const modeManager = new ModeManager(pi, options.initialMode || "write");
		const lspClient = new BslLspClient({ executablePath: options.bslAnalyzerPath, projectPath: projectRoot });
		const inlineFeedback = new InlineFeedbackHandler(lspClient, { bslAnalyzerPath: options.bslAnalyzerPath });
		const permissionManager = new PermissionManager("auto-approve", projectRoot);
		const promptSection = new OnecPromptSection();
		let activeContext: ExtensionContext | undefined;
		const docsService = new DocsService({
			root: projectRoot,
			dbPath: options.docsDbPath,
			onStatus: (text) => activeContext?.ui.setStatus("1c-docs", text),
		});

		registerFeedbackMemory(pi, memoryStore, projectRoot);
		const notifyClient = setupNotify(pi, permissionManager, projectRoot, () => activeContext);

		registerNavigatorTools(pi, lspClient, projectRoot);
		registerAutofixTools(pi);
		registerMetadataTools(pi, projectRoot);
		registerInfobaseTools(pi, projectRoot);
		registerVanessaTools(pi, projectRoot);
		registerGitTools(pi, projectRoot);
		registerDocs(pi, docsService);
		permissionManager.register(pi);
		registerCommands(pi, modeManager, projectRoot);

		registerSessionLifecycle(pi, {
			projectRoot,
			modeManager,
			permissionManager,
			lspClient,
			memoryStore,
			docsService,
			promptSection,
			notifyClient,
			setContext: (ctx) => {
				activeContext = ctx;
			},
		});
		registerAgentHooks(pi, { projectRoot, modeManager, permissionManager, lspClient, inlineFeedback, promptSection });

		return { modeManager, lspClient, inlineFeedback, permissionManager, notifyClient, memoryStore, docsService };
	};
}

export default createOnecAgentExtension();
