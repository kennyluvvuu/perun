// Текстовое представление документации для модели и уведомлений команды /docs.
import type { DocKind, DocOutdatedItem, DocPage, DocSearchHit, DocsStatus, DocsSyncReport } from "./types.ts";

export const KIND_LABELS: Record<DocKind, string> = {
	module: "Модуль",
	procedure: "Процедура",
	function: "Функция",
	variable: "Переменная",
};

const REASON_LABELS: Record<DocOutdatedItem["reason"], string> = {
	new: "новый, без описания",
	changed: "изменен, без описания",
	stale: "описание устарело",
};

function parameterLine(page: DocPage): string[] {
	if (page.parameters.length === 0) {
		return [];
	}
	const items = page.parameters.map((item) => {
		const value = item.defaultValue !== undefined ? ` = ${item.defaultValue}` : "";
		return `${item.byValue ? "Знач " : ""}${item.name}${value}`;
	});
	return [`Параметры: ${items.join(", ")}`];
}

function noteLines(page: DocPage): string[] {
	if (!page.note) {
		return ["Описание: отсутствует (используй 1c_docs_write после разбора кода)."];
	}
	const lines = [
		`Описание (${page.note.author === "user" ? "пользователь" : "агент"}, ${page.note.updatedAt})${page.note.stale ? " [УСТАРЕЛО: код изменился, проверь и обнови]" : ""}:`,
		page.note.summary,
	];
	if (page.note.details) {
		lines.push("", page.note.details);
	}
	for (const item of page.note.cases) {
		lines.push("", `Частный случай: ${item.title}`, item.text);
	}
	return lines;
}

export function formatPage(page: DocPage): string {
	// Собирает страницу документации в компактный текст для ответа инструмента.
	const header = [`# ${KIND_LABELS[page.kind]} ${page.title}`, `id: ${page.id}`, `Файл: ${page.path}:${page.line}`];
	if (page.module) {
		header.push(`Модуль: ${page.module.title} (id: ${page.module.id})`);
	}
	if (page.signature) {
		header.push(`Сигнатура: ${page.directive ? `${page.directive} ` : ""}${page.signature}`);
	}
	if (page.region) {
		header.push(`Область: ${page.region}`);
	}
	const body = [...header, ...parameterLine(page)];
	if (page.comment) {
		body.push("", "Комментарий в коде:", page.comment);
	}
	body.push("", ...noteLines(page));
	if (page.calls.length > 0) {
		body.push("", `Вызывает: ${page.calls.slice(0, 40).join(", ")}`);
	}
	if (page.members.length > 0) {
		body.push("", "Состав модуля:");
		for (const member of page.members) {
			const flags = `${member.isExport ? " Экспорт" : ""}${member.stale ? " [устарело]" : ""}`;
			body.push(`- ${KIND_LABELS[member.kind]} ${member.name}${flags}: ${member.summary ?? "нет описания"}`);
		}
	}
	return body.join("\n");
}

export function formatHits(query: string, hits: readonly DocSearchHit[]): string {
	if (hits.length === 0) {
		return `По запросу «${query}» в документации ничего не найдено.`;
	}
	const lines = hits.map(
		(hit) =>
			`- ${KIND_LABELS[hit.kind]} ${hit.title} — ${hit.moduleTitle}${hit.documented ? "" : " (нет описания)"}\n  id: ${hit.id}\n  ${hit.snippet}`,
	);
	return [`Найдено ${hits.length}:`, ...lines].join("\n");
}

export function formatOutdated(items: readonly DocOutdatedItem[]): string {
	if (items.length === 0) {
		return "Документация актуальна: новых, измененных без описания и устаревших записей нет.";
	}
	const lines = items.map(
		(item) =>
			`- ${KIND_LABELS[item.kind]} ${item.title} — ${item.moduleTitle} (${REASON_LABELS[item.reason]})\n  id: ${item.id}`,
	);
	return [`Требуют описания: ${items.length}`, ...lines].join("\n");
}

export function formatStatus(status: DocsStatus): string {
	const source = status.source === "git" ? "git HEAD" : "рабочий каталог";
	const revision = status.revision ? status.revision.replace(/^worktree:/, "").slice(0, 8) : "не проиндексировано";
	const lines = [
		`Документация проекта ${status.root}`,
		`Источник: ${source}, версия: ${revision}${status.syncing ? " (идет индексация)" : ""}`,
		`Модулей: ${status.modules}, символов: ${status.symbols}, с описанием: ${status.documented}`,
		`Устарело: ${status.stale}, требуют описания: ${status.outdated}`,
	];
	if (status.lastError) {
		lines.push(`Ошибка синхронизации: ${status.lastError}`);
	}
	return lines.join("\n");
}

export function formatSyncReport(report: DocsSyncReport): string {
	if (report.upToDate) {
		return `Документация актуальна (${report.revision.slice(0, 8)}).`;
	}
	return `Документация синхронизирована с ${report.revision.slice(0, 8)}: новых модулей ${report.added}, измененных ${report.changed}, удаленных ${report.removed} за ${report.durationMs} мс.`;
}
