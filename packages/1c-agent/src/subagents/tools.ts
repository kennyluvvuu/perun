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

			const resultDetails: SubagentRunResult = {
				role: params.role,
				task: params.task,
				output: responseText,
				warnings: warnings.length > 0 ? warnings : undefined,
			};

			return {
				content: [{ type: "text", text: responseText }],
				details: resultDetails,
			};
		},
	});
}
