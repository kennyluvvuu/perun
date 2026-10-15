import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getGitBlameContext } from "./blame-context.ts";
import { generateDocsForDiff } from "./docgen.ts";

export function registerGitTools(pi: ExtensionAPI, projectRoot?: string): void {
	// 1. 1c_git_blame_context
	pi.registerTool({
		name: "1c_git_blame_context",
		label: "1C Git Blame Context",
		description:
			"Извлечение исторического контекста создания или модификации методов, переменных и строк кода из истории Git (git blame, git log -S, номера задач/тикетов).",
		promptSnippet: "1c_git_blame_context: поиск истории, коммитов и задач для переменной, метода или строки кода 1С",
		parameters: Type.Object({
			filePath: Type.String({ description: "Путь к файлу модуля .bsl" }),
			symbolOrLine: Type.Union([Type.String(), Type.Number()], {
				description: "Имя переменной/процедуры или номер строки",
			}),
			projectRoot: Type.Optional(Type.String({ description: "Корневой каталог проекта 1С (опционально)" })),
		}),
		execute: async (
			_toolCallId: string,
			params: { filePath: string; symbolOrLine: string | number; projectRoot?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const root = params.projectRoot || projectRoot;
			const result = await getGitBlameContext(params.filePath, params.symbolOrLine, root);

			return {
				content: [{ type: "text", text: result.summary }],
				details: result,
			};
		},
	});

	// 2. 1c_git_docgen
	pi.registerTool({
		name: "1c_git_docgen",
		label: "1C Git DocGen",
		description:
			"Инкрементальный анализ изменений Git и автоматическая генерация/синхронизация документации BSLDoc по единому стандарту ИТС для новых и модифицированных методов.",
		promptSnippet: "1c_git_docgen: генерация BSLDoc документации по стандарту ИТС на основе Git diff",
		parameters: Type.Object({
			targetRef: Type.Optional(
				Type.String({
					description:
						"Git ref для сравнения: 'HEAD~1', 'HEAD', 'staged', 'working' или имя ветки (по умолчанию 'HEAD~1')",
				}),
			),
			filePath: Type.Optional(
				Type.String({ description: "Путь к конкретному файлу .bsl для фильтрации (опционально)" }),
			),
			applyChanges: Type.Optional(
				Type.Boolean({
					description:
						"Применить сгенерированные BSLDoc комментарии прямо в файлы (по умолчанию false - только diff)",
				}),
			),
			projectRoot: Type.Optional(Type.String({ description: "Корневой каталог проекта 1С (опционально)" })),
		}),
		execute: async (
			_toolCallId: string,
			params: { targetRef?: string; filePath?: string; applyChanges?: boolean; projectRoot?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const root = params.projectRoot || projectRoot;
			const result = await generateDocsForDiff(params.targetRef, params.filePath, root, params.applyChanges);

			const lines: string[] = [result.summary];

			for (const file of result.files) {
				if (file.methods.length > 0) {
					lines.push(`\nФайл: ${file.filePath}`);
					for (const m of file.methods) {
						const status = m.hasDoc ? "Обновлен BSLDoc" : "Добавлен BSLDoc";
						lines.push(`  - [${status}] ${m.methodType} ${m.methodName} (строка ${m.startLine})`);
					}
					if (file.patch && !params.applyChanges) {
						lines.push("\nПатч:");
						lines.push(file.patch);
					}
				}
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: result,
			};
		},
	});
}
