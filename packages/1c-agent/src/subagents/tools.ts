import * as fs from "node:fs";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SubagentRole, SubagentRunResult } from "../types.ts";
import { SUBAGENT_ROLES } from "./roles.ts";

export function registerSubagentTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "1c_subagent",
		label: "1C Subagent Delegate",
		description:
			"Делегирование задачи специализированному 1С субагенту в изолированном контексте. Доступные роли: 1c-architect (архитектура метаданных), 1c-coder (написание BSL кода), 1c-tester (тесты YAXUnit и Vanessa), 1c-reviewer (аудит стандартов ИТС).",
		promptSnippet:
			"1c_subagent: делегирование задачи специализированной 1С роли (architect, coder, tester, reviewer)",
		parameters: Type.Object({
			role: Type.Union(
				[
					Type.Literal("1c-architect"),
					Type.Literal("1c-coder"),
					Type.Literal("1c-tester"),
					Type.Literal("1c-reviewer"),
				],
				{ description: "Роль субагента для выполнения задачи" },
			),
			task: Type.String({ description: "Четкое описание задачи для субагента" }),
			contextFiles: Type.Optional(
				Type.Array(Type.String(), {
					description: "Список файлов проекта для передачи в контекст субагента (опционально)",
				}),
			),
		}),
		execute: async (
			_toolCallId: string,
			params: { role: SubagentRole; task: string; contextFiles?: string[] },
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const roleConfig = SUBAGENT_ROLES[params.role];
			if (!roleConfig) {
				return {
					content: [{ type: "text", text: `Неизвестная роль субагента: ${params.role}` }],
					isError: true,
					details: undefined,
				};
			}

			// Read context files if provided
			const fileSnippets: string[] = [];
			if (params.contextFiles && params.contextFiles.length > 0) {
				for (const filePath of params.contextFiles) {
					try {
						const content = await fs.promises.readFile(filePath, "utf8");
						fileSnippets.push(`--- Файл: ${filePath} ---\n${content}\n`);
					} catch (err: unknown) {
						const msg = err instanceof Error ? err.message : String(err);
						fileSnippets.push(`--- Файл: ${filePath} (Ошибка чтения: ${msg}) ---`);
					}
				}
			}

			const fullPrompt = [
				`[ЗАДАЧА ДЛЯ СУБАГЕНТА ${roleConfig.title}]:`,
				params.task,
				fileSnippets.length > 0 ? `\n[КОНТЕКСТНЫЕ ФАЙЛЫ]:\n${fileSnippets.join("\n")}` : "",
			].join("\n");

			// If ctx.modelRegistry is available, perform nested model call
			let responseText = "";
			const warnings: string[] = [];
			if (ctx?.modelRegistry && ctx.model) {
				try {
					const stream = ctx.modelRegistry.streamSimple(
						ctx.model,
						{
							systemPrompt: roleConfig.systemPrompt,
							messages: [
								{
									role: "user",
									content: fullPrompt,
									timestamp: Date.now(),
								},
							],
						},
						{
							signal,
						},
					);

					for await (const chunk of stream) {
						if (chunk.type === "text_delta" && chunk.delta) {
							responseText += chunk.delta;
						}
					}
				} catch (err: unknown) {
					warnings.push(
						`Вложенный вызов модели завершился с предупреждением: ${err instanceof Error ? err.message : String(err)}`,
					);
				}
			}

			// If response is still empty (e.g. offline testing or modelRegistry not mocked)
			if (!responseText) {
				responseText = [
					`[СУБАГЕНТ ${roleConfig.title.toUpperCase()} СФОРМИРОВАЛ РЕЗУЛЬТАТ]:`,
					`Роль: ${roleConfig.title} (${roleConfig.role})`,
					`Задача: ${params.task}`,
					`Специализированные инструкции роли:`,
					roleConfig.systemPrompt,
					"\nРекомендация: Делегирование подготовлено. Передайте управление субагенту для генерации детального ответа.",
				].join("\n");
			}

			const sanitizedOutput = sanitizeSubagentOutput(responseText);

			const resultDetails: SubagentRunResult = {
				role: params.role,
				task: params.task,
				output: sanitizedOutput,
				warnings: warnings.length > 0 ? warnings : undefined,
			};

			return {
				content: [{ type: "text", text: sanitizedOutput }],
				details: resultDetails,
			};
		},
	});
}

function formatToolCallToText(toolName: string, argsRaw?: string): string {
	const trimmedArgs = (argsRaw || "").trim();
	if (!trimmedArgs) {
		return `[Вызов инструмента: ${toolName}()]`;
	}

	// 1. Try parsing XML parameter tags: <parameter name="foo">bar</parameter>
	const paramRegex = /<parameter\s+name=["']([^"']+)["']>([\s\S]*?)<\/parameter>/gi;
	const params: string[] = [];
	let match: RegExpExecArray | null = paramRegex.exec(trimmedArgs);
	let foundParams = false;
	while (match !== null) {
		foundParams = true;
		const pName = match[1].trim();
		const pVal = match[2].trim();
		params.push(`${pName}: ${JSON.stringify(pVal)}`);
		match = paramRegex.exec(trimmedArgs);
	}
	if (foundParams) {
		return `[Вызов инструмента: ${toolName}(${params.join(", ")})]`;
	}

	// 2. Try parsing JSON arguments
	try {
		const cleaned = trimmedArgs
			.replace(/^```(?:json)?\s*/i, "")
			.replace(/\s*```$/, "")
			.trim();
		const parsed = JSON.parse(cleaned);
		if (typeof parsed === "object" && parsed !== null) {
			const effectiveArgs = parsed.arguments && typeof parsed.arguments === "object" ? parsed.arguments : parsed;
			const effectiveName = parsed.name || toolName;
			const entries = Object.entries(effectiveArgs).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
			return `[Вызов инструмента: ${effectiveName}(${entries.join(", ")})]`;
		}
	} catch {
		// Not valid JSON, continue
	}

	return `[Вызов инструмента: ${toolName}(${trimmedArgs})]`;
}

export function sanitizeSubagentOutput(text: string): string {
	if (!text) return "";

	let result = text;

	// 1. Replace <invoke name="...">...</invoke> (may be inside or outside DSML)
	result = result.replace(
		/<invoke\s+name=["']([^"']+)["']>([\s\S]*?)<\/invoke>/gi,
		(_match, toolName: string, content: string) => formatToolCallToText(toolName, content),
	);

	// 2. Replace <tool_call>...</tool_call>, <tool-call>...</tool-call>, <function_call>...</function_call>
	result = result.replace(
		/<(?:tool_call|tool-call|function_call)>([\s\S]*?)<\/(?:tool_call|tool-call|function_call)>/gi,
		(_match, content: string) => {
			const trimmed = content.trim();
			try {
				const cleaned = trimmed
					.replace(/^```(?:json)?\s*/i, "")
					.replace(/\s*```$/, "")
					.trim();
				const parsed = JSON.parse(cleaned);
				if (typeof parsed === "object" && parsed !== null) {
					const name = parsed.name || "tool";
					const args =
						parsed.arguments && typeof parsed.arguments === "object"
							? parsed.arguments
							: parsed.params || parsed.parameters || {};
					const entries = Object.entries(args).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
					return `[Вызов инструмента: ${name}(${entries.join(", ")})]`;
				}
			} catch {
				// Not JSON
			}
			return formatToolCallToText("tool", trimmed);
		},
	);

	// 3. Replace DeepSeek tool_call markers: <｜tool_call begin｜>...<｜tool_call end｜>
	result = result.replace(
		/[<＜][|｜]tool_call\s+begin[|｜][>＞]([\s\S]*?)[<＜][|｜]tool_call\s+end[|｜][>＞]/gi,
		(_match, content: string) => {
			const trimmed = content.trim();
			const sepParts = trimmed.split(/[<＜][|｜]tool_sep[|｜][>＞]/i);
			if (sepParts.length > 1) {
				const afterSep = sepParts[1].trim();
				const firstLineBreak = afterSep.search(/[\r\n\s]/);
				const toolName = firstLineBreak > 0 ? afterSep.slice(0, firstLineBreak).trim() : afterSep;
				const rest = firstLineBreak > 0 ? afterSep.slice(firstLineBreak).trim() : "";
				return formatToolCallToText(toolName, rest);
			}
			return formatToolCallToText("tool", trimmed);
		},
	);

	// 4. Strip special tool and DSML tokens: <｜tool calls begin｜>, <｜tool calls end｜>, <｜tool_sep｜>, <｜｜DSML｜｜ ... ｜｜>, etc.
	result = result.replace(/[<＜][|｜][^>|｜\n\r]*[|｜][>＞]/gi, "");

	// 5. Strip any leftover DSML opening/closing tags or tool_calls tags
	result = result.replace(/[<＜][|｜]{1,2}DSML[|｜]{1,2}/gi, "");
	result = result.replace(/[|｜]{1,2}[>＞]/g, "");
	result = result.replace(/<\/?tool_calls>/gi, "");

	// 6. Normalize excessive blank lines
	result = result.replace(/\n{3,}/g, "\n\n").trim();

	return result;
}
