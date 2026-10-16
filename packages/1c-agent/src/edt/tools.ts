// Инструмент 1c_md: обзор, создание, дополнение и проверка метаданных проекта 1C:EDT.

import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describeConfiguration, describeObject } from "./info-service.ts";
import { MD_SCHEMA, type MdParams } from "./md-schema.ts";
import { findKind, parseObjectRef } from "./metadata-kinds.ts";
import { findEdtProjects, isExtensionProject } from "./project-locator.ts";
import { addToObject, createObject } from "./scaffold-service.ts";
import type { ChangeReport, EdtProject, MdoRef } from "./types.ts";
import { formatDiagnostics, validateProject } from "./validate-project.ts";

const READ_ONLY_ACTIONS = new Set(["info", "validate"]);

export function isReadOnlyMdCall(input: unknown): boolean {
	const action = typeof input === "object" && input !== null ? (input as { action?: unknown }).action : undefined;
	return typeof action === "string" && READ_ONLY_ACTIONS.has(action);
}

export function resolveEdtProject(cwd: string): EdtProject | undefined {
	const projects = findEdtProjects(cwd);
	return projects.find((project) => !isExtensionProject(project)) ?? projects[0];
}

function requireRef(params: MdParams): MdoRef {
	const ref = params.object ? parseObjectRef(params.object) : undefined;
	if (!ref) {
		throw new Error(
			`укажите object в виде «Вид.Имя», например «Документ.ПеремещениеТоваров» (получено: ${params.object ?? "—"})`,
		);
	}
	return ref;
}

function formatReport(report: ChangeReport): string {
	const errors = report.diagnostics.filter((item) => item.severity === "error").length;
	return [
		...(report.created.length > 0 ? [`Создано: ${report.created.join(", ")}`] : []),
		...(report.modified.length > 0 ? [`Изменено: ${report.modified.join(", ")}`] : []),
		report.diagnostics.length === 0
			? "Проверка .mdo: замечаний нет."
			: `Проверка .mdo: ошибок ${errors}\n${formatDiagnostics(report.diagnostics)}`,
	].join("\n");
}

function runInfo(project: EdtProject, params: MdParams): string {
	if (!params.object) {
		return describeConfiguration(project);
	}
	const ref = parseObjectRef(params.object);
	if (ref) {
		return describeObject(project, ref);
	}
	const kind = findKind(params.object);
	if (!kind) {
		throw new Error(`не понимаю «${params.object}»: ожидается «Вид.Имя» или вид объекта`);
	}
	return describeConfiguration(project, kind);
}

function runValidate(project: EdtProject): { text: string; failed: boolean } {
	const result = validateProject(project);
	const errors = result.diagnostics.filter((item) => item.severity === "error").length;
	if (result.diagnostics.length === 0) {
		return { text: `Проверено файлов .mdo: ${result.files}. Замечаний нет.`, failed: false };
	}
	return {
		text: `Проверено файлов .mdo: ${result.files}. Ошибок: ${errors}.\n${formatDiagnostics(result.diagnostics)}`,
		failed: errors > 0,
	};
}

export function runMdAction(project: EdtProject, params: MdParams): { text: string; failed: boolean } {
	switch (params.action) {
		case "info":
			return { text: runInfo(project, params), failed: false };
		case "validate":
			return runValidate(project);
		case "create": {
			const report = createObject(project, { ...params, ref: requireRef(params) });
			return { text: formatReport(report), failed: report.diagnostics.some((item) => item.severity === "error") };
		}
		case "add": {
			const report = addToObject(project, requireRef(params), params);
			return { text: formatReport(report), failed: report.diagnostics.some((item) => item.severity === "error") };
		}
	}
}

export function registerMetadataTools(pi: ExtensionAPI, projectRoot?: string): void {
	// Регистрирует инструмент 1c_md, работающий с EDT-проектом текущего каталога.
	pi.registerTool({
		name: "1c_md",
		label: "1C Metadata (EDT)",
		description:
			"Метаданные проекта 1C:EDT. info — состав объекта (реквизиты с типами, ТЧ, измерения, ресурсы, движения, модули) или обзор конфигурации; " +
			"create — новый объект (Справочник, Документ, Перечисление, Константа, ОбщийМодуль, РегистрСведений, РегистрНакопления, Обработка, Отчет) " +
			"с uuid, producedTypes, регистрацией в Configuration.mdo, подсистемой и заготовкой модуля; add — реквизиты/ТЧ/измерения/ресурсы/значения/движения в существующий объект; " +
			"validate — проверка всех .mdo проекта. После create/add результат сразу проверяется.",
		promptSnippet: "1c_md: метаданные EDT — info, create, add, validate (.mdo с uuid и регистрацией)",
		parameters: MD_SCHEMA,
		execute: async (
			_toolCallId: string,
			params: MdParams,
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const cwd = ctx?.cwd || projectRoot || process.cwd();
			const project = resolveEdtProject(cwd);
			if (!project) {
				const text = `EDT-проект не найден в ${cwd}: ожидается каталог с src/Configuration/Configuration.mdo.`;
				return { content: [{ type: "text", text }], isError: true, details: undefined };
			}
			try {
				const result = runMdAction(project, params);
				return { content: [{ type: "text", text: result.text }], isError: result.failed, details: undefined };
			} catch (error: unknown) {
				const text = `1c_md ${params.action}: ${error instanceof Error ? error.message : String(error)}`;
				return { content: [{ type: "text", text }], isError: true, details: undefined };
			}
		},
	});
}
