// Проверка одного файла .mdo: синтаксис XML, соответствие имени и каталогу, uuid, дубли имён, регистрация и ссылки.

import * as path from "node:path";
import { readMdo } from "./mdo-reader.ts";
import { findKind } from "./metadata-kinds.ts";
import { relativeToProject } from "./project-locator.ts";
import { getScaffoldKind } from "./scaffold-kinds.ts";
import type { MdoDiagnostic, MdoSummary } from "./types.ts";
import { checkReferences, checkRegisteredObjects, type ValidationContext } from "./validate-references.ts";
import { checkXmlSyntax, lineAt, lineOf } from "./xml-reader.ts";

const IDENTIFIER = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkIdentifiers(text: string, file: string): MdoDiagnostic[] {
	const diagnostics: MdoDiagnostic[] = [];
	const seen = new Map<string, number>();
	for (const match of text.matchAll(/\b(uuid|typeId|valueTypeId)="([^"]*)"/g)) {
		const line = lineAt(text, match.index ?? 0);
		const value = match[2];
		if (!UUID.test(value)) {
			diagnostics.push({ file, line, severity: "error", message: `${match[1]}="${value}" — не UUID` });
			continue;
		}
		const first = seen.get(value.toLowerCase());
		if (first !== undefined) {
			diagnostics.push({
				file,
				line,
				severity: "error",
				message: `UUID ${value} повторяется (впервые в строке ${first})`,
			});
		} else {
			seen.set(value.toLowerCase(), line);
		}
	}
	return diagnostics;
}

function duplicateNames(names: readonly string[]): string[] {
	const seen = new Set<string>();
	const duplicates = new Set<string>();
	for (const name of names) {
		const key = name.toLowerCase();
		if (seen.has(key)) duplicates.add(name);
		seen.add(key);
	}
	return [...duplicates];
}

function checkNames(summary: MdoSummary, text: string, file: string): MdoDiagnostic[] {
	const diagnostics: MdoDiagnostic[] = [];
	const report = (name: string, message: string): void => {
		diagnostics.push({ file, line: lineOf(text, `<name>${name}</name>`), severity: "error", message });
	};
	const groups = [
		[...summary.attributes, ...summary.tabularSections, ...summary.dimensions, ...summary.resources].map(
			(item) => item.name,
		),
		summary.enumValues.map((item) => item.name),
		...summary.tabularSections.map((section) => section.attributes.map((item) => item.name)),
	];
	for (const group of groups) {
		for (const name of group) {
			if (!IDENTIFIER.test(name)) report(name, `имя «${name}» не является допустимым идентификатором 1С`);
		}
		for (const name of duplicateNames(group)) report(name, `имя «${name}» используется повторно`);
	}
	return diagnostics;
}

function checkPlacement(
	context: ValidationContext,
	summary: MdoSummary,
	filePath: string,
	text: string,
	file: string,
): MdoDiagnostic[] {
	const segments = path.relative(context.project.srcDir, filePath).split(path.sep);
	const diagnostics: MdoDiagnostic[] = [];
	const report = (message: string, needle = `<name>${summary.name}</name>`): void => {
		diagnostics.push({ file, line: lineOf(text, needle), severity: "error", message });
	};
	const baseName = path.basename(filePath, ".mdo");
	if (summary.kind !== "Configuration" && summary.name !== baseName) {
		report(`имя объекта «${summary.name}» не совпадает с именем файла «${baseName}»`);
	}
	if (!IDENTIFIER.test(summary.name)) {
		report(`имя «${summary.name}» не является допустимым идентификатором 1С`);
	}
	if (summary.kind === "Configuration" || segments.length !== 3) {
		return diagnostics;
	}
	const folderKind = findKind(segments[0]);
	if (folderKind && folderKind.kind !== summary.kind) {
		report(
			`объект вида ${summary.kind} лежит в каталоге ${segments[0]} (ожидается ${folderKind.kind})`,
			`<mdclass:${summary.kind}`,
		);
	}
	const reference = `${summary.kind}.${summary.name}`;
	if (context.configuration && !context.configuration.registered.has(reference)) {
		report(`объект ${reference} не зарегистрирован в src/Configuration/Configuration.mdo`);
	}
	const scaffold = getScaffoldKind(summary.kind);
	if (scaffold && scaffold.producedTypes.length > 0 && summary.producedTypeIds.length === 0) {
		report(`нет блока <producedTypes>: EDT не сможет построить типы объекта`);
	}
	if (summary.kind === "AccumulationRegister") {
		for (const resource of summary.resources.filter((item) => !item.types.every((type) => type === "Number"))) {
			report(
				`ресурс «${resource.name}» регистра накопления должен иметь тип Number`,
				`<name>${resource.name}</name>`,
			);
		}
	}
	return diagnostics;
}

export function validateMdoText(context: ValidationContext, filePath: string, text: string): MdoDiagnostic[] {
	// Проверяет текст .mdo и возвращает диагностики с номерами строк; пустой список — файл корректен.
	const file = relativeToProject(context.project, filePath);
	const syntax = checkXmlSyntax(text);
	if (syntax) {
		return [{ file, line: syntax.line, severity: "error", message: `синтаксис XML: ${syntax.message}` }];
	}
	const summary = readMdo(text);
	if (!summary) {
		return [
			{ file, line: 1, severity: "error", message: "корневой элемент должен быть mdclass:<Вид> (формат 1C:EDT)" },
		];
	}
	const diagnostics = [
		...checkIdentifiers(text, file),
		...checkPlacement(context, summary, filePath, text, file),
		...checkNames(summary, text, file),
		...checkReferences(context, summary, text, file),
	];
	if (summary.kind === "Configuration") {
		diagnostics.push(...checkRegisteredObjects(context, text, file));
	}
	return diagnostics.sort((left, right) => left.line - right.line);
}
