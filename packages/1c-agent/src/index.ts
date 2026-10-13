import * as fs from "node:fs";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionStartEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { registerAutofixTools } from "./autofix/index.ts";
import { BslLspClient, InlineFeedbackHandler } from "./lsp/index.ts";
import { ModeManager } from "./modes/index.ts";
import { registerNavigatorTools } from "./navigator/index.ts";
import { PermissionManager } from "./permissions/index.ts";
import { registerSubagentTools } from "./subagents/index.ts";
import type { AgentMode } from "./types.ts";

export * from "./autofix/index.ts";
export * from "./lsp/index.ts";
export * from "./modes/index.ts";
export * from "./navigator/index.ts";
export * from "./permissions/index.ts";
export * from "./subagents/index.ts";
export * from "./types.ts";

export interface OnecAgentExtensionOptions {
	initialMode?: AgentMode;
	bslAnalyzerPath?: string;
	projectRoot?: string;
}

export function createOnecAgentExtension(options: OnecAgentExtensionOptions = {}) {
	return function onecAgentExtension(pi: ExtensionAPI): {
		modeManager: ModeManager;
		lspClient: BslLspClient;
		inlineFeedback: InlineFeedbackHandler;
		permissionManager: PermissionManager;
	} {
		const projectRoot = options.projectRoot || process.cwd();
		const modeManager = new ModeManager(pi, options.initialMode || "write");
		const lspClient = new BslLspClient({
			executablePath: options.bslAnalyzerPath,
			projectPath: projectRoot,
		});
		const inlineFeedback = new InlineFeedbackHandler(lspClient);
		const permissionManager = new PermissionManager("auto-approve", projectRoot);

		// 1. Register tools
		registerNavigatorTools(pi, lspClient, projectRoot);
		registerAutofixTools(pi);
		registerSubagentTools(pi);
		permissionManager.register(pi);

		// 2. Register /mode command
		pi.registerCommand("mode", {
			description: "Управление режимом агента 1С: /mode [find | explain | write | plan]",
			handler: async (args: string, ctx: ExtensionCommandContext) => {
				const trimmed = args.trim().toLowerCase();
				if (trimmed === "find" || trimmed === "explain" || trimmed === "write" || trimmed === "plan") {
					modeManager.setMode(trimmed as AgentMode, ctx);
					ctx.ui.notify(`Режим агента 1С: ${modeManager.getConfig().title}`, "info");
				} else {
					const next = modeManager.cycleMode(ctx);
					ctx.ui.notify(`Текущий режим 1С: ${modeManager.getConfig().title} (${next})`, "info");
				}
			},
		});

		// 3. Register alt+m shortcut for mode cycling
		try {
			pi.registerShortcut("alt+m", {
				description: "Циклическое переключение режимов 1С (НАЙТИ -> ОБЪЯСНИТЬ -> НАПИСАТЬ -> ПЛАНИРОВАТЬ)",
				handler: (ctx: ExtensionContext) => {
					modeManager.cycleMode(ctx);
				},
			});
		} catch {
			// Shortcut may already be registered or unsupported in current environment
		}

		// 4. Lifecycle event: session_start
		pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
			modeManager.initializeTools();
			modeManager.updateUI(ctx);
			permissionManager.updateUI(ctx);

			// Automatically start LSP if 1C files/projects are detected
			const has1cFiles = await detect1cProject(projectRoot);
			if (has1cFiles) {
				await lspClient.start(projectRoot).catch(() => {});
			}
		});

		// 5. Lifecycle event: session_shutdown
		pi.on("session_shutdown", async () => {
			await lspClient.stop().catch(() => {});
		});

		// 6. Hook: before_agent_start - inject mode instructions & 1C LSP environment
		pi.on("before_agent_start", (event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined => {
			const promptInjection = modeManager.getSystemPromptInjection();
			const envInjection =
				"ВСТРОЕННОЕ ОКРУЖЕНИЕ И LSP 1С (ПЕРУН):\n" +
				"- В ПерУН уже встроен и работает фоновый LSP-сервер bsl-analyzer. При каждом редактировании файлов .bsl и .os через write или edit диагностика синтаксиса и стандартов ИТС возвращается автоматически в результате инструмента.\n" +
				"- НЕ трать шаги на поиск или установку bsl-analyzer через bash (which, find, whereis) — анализатор уже запущен и полностью функционален.\n" +
				"- Используй инструменты: bsl_fix_standards (авто-патчи ИТС), 1c_call_hierarchy (граф вызовов), 1c_impact_analysis (связи регистров и документов), 1c_ast_symbols (структура модуля), 1c_subagent (делегирование).\n" +
				"- Разработка ведется в формате проектов 1C:EDT (Configuration.mdo, файлы .mdo, модули .bsl, .project).";

			if (event.systemPromptOptions?.sections) {
				event.systemPromptOptions.sections.onec_environment = envInjection;
			}
			if (event.systemPromptOptions?.promptGuidelines) {
				event.systemPromptOptions.promptGuidelines.push(promptInjection);
				return undefined;
			}
			if (event.systemPrompt) {
				return {
					systemPrompt: `${event.systemPrompt}\n\n${envInjection}\n\n${promptInjection}`,
				};
			}
			return undefined;
		});

		// 7. Hook: tool_call - mode isolation & permission system
		pi.on(
			"tool_call",
			async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
				// A. Mode check (blocks mutating tools in read-only modes)
				const modeCheck = modeManager.checkToolCall(event.toolName);
				if (modeCheck.block) {
					return { block: true, reason: modeCheck.reason };
				}

				// B. Permission check (strict / auto-approve / yolo)
				const permCheck = await permissionManager.handleToolCall(
					{ toolName: event.toolName, input: event.input as Record<string, unknown> },
					ctx,
				);
				if (permCheck.block) {
					return { block: true, reason: permCheck.reason };
				}

				return undefined;
			},
		);

		// 8. Hook: tool_result - inline LSP feedback on write/edit
		pi.on("tool_result", async (event: ToolResultEvent): Promise<ToolResultEventResult | undefined> => {
			const feedback = await inlineFeedback.handleToolResult(event);
			if (feedback?.content) {
				return {
					content: feedback.content,
				};
			}
			return undefined;
		});

		return {
			modeManager,
			lspClient,
			inlineFeedback,
			permissionManager,
		};
	};
}

async function detect1cProject(directory: string): Promise<boolean> {
	try {
		const items = await fs.promises.readdir(directory);
		for (const item of items) {
			const lower = item.toLowerCase();
			if (
				lower.endsWith(".bsl") ||
				lower.endsWith(".os") ||
				lower === "configuration.mdo" ||
				lower === "bsl-analyzer.toml" ||
				lower === ".project"
			) {
				return true;
			}
		}
	} catch {
		// Ignore readdir error
	}
	return false;
}

export default createOnecAgentExtension();
