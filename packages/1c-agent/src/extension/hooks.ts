// Хуки агента: раздел промпта 1С и режима, проверка режима и прав перед вызовом, диагностика BSL и .mdo после записи.

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionContext,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { editedFilePath, mdoFeedbackText } from "../edt/feedback.ts";
import type { BslLspClient, InlineFeedbackHandler } from "../lsp/index.ts";
import type { ModeManager } from "../modes/index.ts";
import type { PermissionManager } from "../permissions/index.ts";
import type { OnecPromptSection } from "../prompt/index.ts";
import { detect1cProject } from "./project-detect.ts";

export interface HookDependencies {
	readonly projectRoot: string;
	readonly modeManager: ModeManager;
	readonly permissionManager: PermissionManager;
	readonly lspClient: BslLspClient;
	readonly inlineFeedback: InlineFeedbackHandler;
	readonly promptSection: OnecPromptSection;
}

async function ensureLsp(deps: HookDependencies, event: ToolResultEvent, cwd: string): Promise<void> {
	const filePath = editedFilePath(event.toolName, event.input, cwd);
	if (filePath && deps.inlineFeedback.isBslFile(filePath) && !deps.lspClient.isReady()) {
		if (await detect1cProject(deps.projectRoot)) {
			await deps.lspClient.start(deps.projectRoot).catch(() => undefined);
		}
	}
}

export function registerAgentHooks(pi: ExtensionAPI, deps: HookDependencies): void {
	// Подключает к агенту раздел промпта 1С, проверку вызовов инструментов и диагностику после записи файлов.
	pi.on("before_agent_start", (event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined => {
		const options = event.systemPromptOptions;
		const section = deps.promptSection.get(options?.cwd || deps.projectRoot);
		const modeText = deps.modeManager.getSystemPromptInjection();
		if (options?.sections) {
			options.sections.onec_environment = section;
		}
		if (options?.promptGuidelines) {
			options.promptGuidelines.push(modeText);
			return undefined;
		}
		return event.systemPrompt ? { systemPrompt: `${event.systemPrompt}\n\n${section}\n\n${modeText}` } : undefined;
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
		const modeCheck = deps.modeManager.checkToolCall(event.toolName, event.input);
		if (modeCheck.block) {
			return { block: true, reason: modeCheck.reason };
		}
		const permission = await deps.permissionManager.handleToolCall(
			{ toolName: event.toolName, input: event.input as Record<string, unknown> },
			ctx,
		);
		return permission.block ? { block: true, reason: permission.reason } : undefined;
	});

	pi.on(
		"tool_result",
		async (event: ToolResultEvent, ctx: ExtensionContext): Promise<ToolResultEventResult | undefined> => {
			const cwd = ctx?.cwd || deps.projectRoot;
			await ensureLsp(deps, event, cwd);
			const bsl = await deps.inlineFeedback.handleToolResult(event);
			let content: (TextContent | ImageContent)[] | undefined = bsl?.content;
			const filePath = editedFilePath(event.toolName, event.input, cwd);
			const mdo = filePath ? mdoFeedbackText(filePath) : undefined;
			if (mdo) {
				content = [...(content ?? event.content ?? []), { type: "text", text: mdo }];
			}
			return content ? { content } : undefined;
		},
	);
}
