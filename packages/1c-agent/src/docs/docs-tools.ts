// Инструменты агента для единой документации: поиск, чтение, запись описаний и список требующих описания.
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatHits, formatOutdated, formatPage } from "./docs-format.ts";
import type { DocsService } from "./docs-service.ts";
import { DOC_KINDS, type DocCase, type DocKind } from "./types.ts";

const KIND_SCHEMA = Type.Optional(
	Type.Union(
		DOC_KINDS.map((kind) => Type.Literal(kind)),
		{ description: "Фильтр по виду: module, procedure, function, variable" },
	),
);

function textResult<T>(text: string, details: T): AgentToolResult<T> {
	return { content: [{ type: "text", text }], details };
}

export function registerDocsTools(pi: ExtensionAPI, service: DocsService): void {
	// Регистрирует инструменты 1c_docs_* поверх общего сервиса документации.
	pi.registerTool({
		name: "1c_docs_search",
		label: "1C Docs Search",
		description:
			"Поиск в единой документации проекта (модули, процедуры, функции, переменные) по имени и по тексту описаний. Используй ПЕРЕД разбором кода с нуля.",
		promptSnippet: "1c_docs_search: поиск готовых описаний модулей и методов в документации ПерУН",
		parameters: Type.Object({
			query: Type.String({ description: "Имя или фрагмент имени метода/модуля, либо слова из описания" }),
			kind: KIND_SCHEMA,
			limit: Type.Optional(Type.Number({ description: "Максимум результатов (по умолчанию 15)" })),
		}),
		execute: async (_id: string, params: { query: string; kind?: DocKind; limit?: number }) => {
			service.refresh();
			const hits = service.search(params.query, params.kind, Math.min(Math.max(params.limit ?? 15, 1), 50));
			return textResult(formatHits(params.query, hits), { hits });
		},
	});

	pi.registerTool({
		name: "1c_docs_read",
		label: "1C Docs Read",
		description:
			"Чтение страницы документации: сигнатура, комментарий из кода, сохраненное описание, частные случаи, состав модуля. id — путь модуля относительно проекта, для символа — 'путь#Имя'.",
		promptSnippet: "1c_docs_read: прочитать сохраненное описание модуля или метода",
		parameters: Type.Object({
			id: Type.String({
				description:
					"Например 'src/CommonModules/ОбщегоНазначения/Module.bsl' или '...Module.bsl#СообщитьПользователю'",
			}),
		}),
		execute: async (_id: string, params: { id: string }) => {
			service.refresh();
			const page = service.page(params.id);
			return textResult(formatPage(page), { page });
		},
	});

	pi.registerTool({
		name: "1c_docs_write",
		label: "1C Docs Write",
		description:
			"Сохранение или обновление описания модуля/метода/переменной в единой документации проекта. Пиши по-русски, по существу: что делает, когда вызывается, побочные эффекты, частные случаи.",
		promptSnippet: "1c_docs_write: сохранить описание модуля или метода в документацию ПерУН",
		parameters: Type.Object({
			id: Type.String({ description: "Путь модуля или 'путь#Имя' символа" }),
			summary: Type.String({ description: "Кратко: что делает (1-3 предложения)" }),
			details: Type.Optional(Type.String({ description: "Подробности в Markdown: алгоритм, данные, связи" })),
			cases: Type.Optional(
				Type.Array(
					Type.Object({
						title: Type.String({ description: "Условие частного случая" }),
						text: Type.String({ description: "Что происходит в этом случае" }),
					}),
					{ description: "Частные случаи и особенности поведения" },
				),
			),
		}),
		execute: async (_id: string, params: { id: string; summary: string; details?: string; cases?: DocCase[] }) => {
			const page = await service.saveNote(params.id, params, "agent");
			const text = page
				? `Описание сохранено: ${page.title} (id: ${page.id}).`
				: `Описание сохранено для ${params.id}; оно появится на странице после коммита этого кода.`;
			return textResult(text, { page });
		},
	});

	pi.registerTool({
		name: "1c_docs_outdated",
		label: "1C Docs Outdated",
		description:
			"Список записей, которым нужно описание: новые и измененные в последних коммитах без описания, а также устаревшие описания.",
		promptSnippet: "1c_docs_outdated: что в документации нужно дописать или исправить",
		parameters: Type.Object({
			limit: Type.Optional(Type.Number({ description: "Максимум записей (по умолчанию 20)" })),
		}),
		execute: async (_id: string, params: { limit?: number }) => {
			await service.sync().catch(() => undefined);
			const items = service.outdated(Math.min(Math.max(params.limit ?? 20, 1), 100));
			return textResult(formatOutdated(items), { items });
		},
	});
}
