// Текстовые сводки для агента: состав объекта метаданных EDT и обзор конфигурации по видам объектов.

import * as fs from "node:fs";
import * as path from "node:path";
import { readMdo } from "./mdo-reader.ts";
import { KINDS } from "./metadata-kinds.ts";
import { readConfigurationIndex } from "./project-locator.ts";
import { objectFile } from "./scaffold-registry.ts";
import type { EdtProject, KindInfo, MdoField, MdoRef } from "./types.ts";

function listObjects(project: EdtProject, kind: KindInfo): string[] {
	const dir = path.join(project.srcDir, kind.folder);
	try {
		return fs
			.readdirSync(dir, { withFileTypes: true })
			.filter((entry) => entry.isDirectory() && fs.existsSync(path.join(dir, entry.name, `${entry.name}.mdo`)))
			.map((entry) => entry.name)
			.sort((left, right) => left.localeCompare(right, "ru"));
	} catch {
		return [];
	}
}

function listModules(dir: string): string[] {
	const modules: string[] = [];
	const walk = (current: string): void => {
		for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
			const full = path.join(current, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith(".bsl")) modules.push(path.relative(dir, full).split(path.sep).join("/"));
		}
	};
	walk(dir);
	return modules.sort();
}

function fieldLines(title: string, fields: readonly MdoField[], indent = "  "): string[] {
	if (fields.length === 0) {
		return [];
	}
	return [`${title}:`, ...fields.map((field) => `${indent}${field.name}: ${field.typeText || "—"}`)];
}

function listLine(title: string, items: readonly string[]): string[] {
	return items.length > 0 ? [`${title}: ${items.join(", ")}`] : [];
}

export function describeObject(project: EdtProject, ref: MdoRef): string {
	// Возвращает компактное описание объекта: реквизиты с типами, ТЧ, измерения, ресурсы, движения, модули.
	const filePath = objectFile(project, ref.kind, ref.name);
	if (!fs.existsSync(filePath)) {
		const similar = listObjects(project, ref.kind).filter((name) =>
			name.toLowerCase().includes(ref.name.toLowerCase().slice(0, 4)),
		);
		return `Объект ${ref.kind.ru}.${ref.name} не найден.${similar.length > 0 ? ` Похожие: ${similar.slice(0, 10).join(", ")}` : ""}`;
	}
	const summary = readMdo(fs.readFileSync(filePath, "utf8"));
	if (!summary) {
		return `Файл ${path.relative(project.root, filePath)} не является .mdo формата EDT.`;
	}
	const properties = Object.entries(summary.properties).map(([key, value]) => `${key}=${value}`);
	return [
		`${ref.kind.ru}.${summary.name} (${summary.kind})${summary.synonym ? ` — «${summary.synonym}»` : ""}`,
		`Файл: ${path.relative(project.root, filePath).split(path.sep).join("/")}`,
		...listLine("Модули", listModules(path.dirname(filePath))),
		...listLine("Свойства", properties),
		...fieldLines("Реквизиты", summary.attributes),
		...summary.tabularSections.flatMap((section) => fieldLines(`ТЧ ${section.name}`, section.attributes)),
		...fieldLines("Измерения", summary.dimensions),
		...fieldLines("Ресурсы", summary.resources),
		...listLine(
			"Значения",
			summary.enumValues.map((value) => value.name),
		),
		...listLine("Движения", summary.registerRecords),
		...listLine("Формы", summary.forms),
		...listLine("Команды", summary.commands),
		...listLine("Макеты", summary.templates),
		...listLine("Состав", summary.content),
	].join("\n");
}

export function describeConfiguration(project: EdtProject, kind?: KindInfo): string {
	const index = readConfigurationIndex(project);
	const header = [
		`Конфигурация ${index?.name ?? "?"} (режим совместимости ${index?.compatibilityMode ?? "?"}, язык синонимов ${index?.languageCode ?? "ru"})`,
		`Проект EDT: ${project.root}`,
	];
	if (kind) {
		const names = listObjects(project, kind);
		return [...header, `${kind.ru} (${kind.folder}), ${names.length}:`, names.join(", ") || "—"].join("\n");
	}
	const counts = KINDS.map((info) => [info, listObjects(project, info).length] as const)
		.filter(([, count]) => count > 0)
		.map(([info, count]) => `${info.ru}: ${count}`);
	return [
		...header,
		counts.join(" · "),
		'Список объектов вида: 1c_md info с object="Документ" (или другим видом).',
	].join("\n");
}
