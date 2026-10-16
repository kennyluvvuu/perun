// Создание и дополнение объектов метаданных EDT: .mdo, регистрация, подсистема, модули и проверка результата.

import * as fs from "node:fs";
import * as path from "node:path";
import { moduleTemplate } from "./bsl-templates.ts";
import { readMdo } from "./mdo-reader.ts";
import { renderObjectSkeleton, synonymFromName } from "./mdo-templates.ts";
import { readConfigurationIndex } from "./project-locator.ts";
import { buildChildren } from "./scaffold-fields.ts";
import { getScaffoldKind, type ScaffoldKind } from "./scaffold-kinds.ts";
import {
	applyWrites,
	normalizeRegisterRecords,
	objectFile,
	type PendingWrite,
	registrationWrite,
	subsystemWrite,
} from "./scaffold-registry.ts";
import { parseTypeSpec, renderTypeXml } from "./type-spec.ts";
import type { ChangeReport, ChildrenSpec, CreateSpec, EdtProject, MdoRef } from "./types.ts";
import { validateMdoText } from "./validate-file.ts";
import { createValidationContext } from "./validate-references.ts";
import { ensureRootNamespaces, insertIntoTabularSection, insertTopLevel } from "./xml-insert.ts";

const IDENTIFIER = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*$/u;

function requireScaffold(ref: MdoRef): ScaffoldKind {
	const scaffold = getScaffoldKind(ref.kind.kind);
	if (!scaffold) {
		throw new Error(
			`вид ${ref.kind.kind} пока не поддерживается 1c_md; правьте .mdo через edit по образцу соседнего объекта`,
		);
	}
	if (!IDENTIFIER.test(ref.name)) {
		throw new Error(`«${ref.name}» не является допустимым именем объекта 1С`);
	}
	return scaffold;
}

function applyChildren(
	text: string,
	project: EdtProject,
	ref: MdoRef,
	scaffold: ScaffoldKind,
	spec: ChildrenSpec,
	language: string,
): string {
	const build = buildChildren(ref.kind.kind, scaffold, spec, language);
	if (build.errors.length > 0) {
		throw new Error(build.errors.join("; "));
	}
	let result = text;
	if (spec.tabularSection && build.tabularLines.length > 0) {
		result = insertIntoTabularSection(result, spec.tabularSection, build.tabularLines);
	}
	for (const block of build.blocks) {
		result = insertTopLevel(result, scaffold.order, block.tag, block.lines);
	}
	for (const reference of normalizeRegisterRecords(project, spec.registerRecords ?? [])) {
		if (!result.includes(`<registerRecords>${reference}</registerRecords>`)) {
			result = insertTopLevel(result, scaffold.order, "registerRecords", [
				`  <registerRecords>${reference}</registerRecords>`,
			]);
		}
	}
	return ensureRootNamespaces(result);
}

function checkDuplicates(text: string, spec: ChildrenSpec): void {
	const summary = readMdo(text);
	if (!summary) return;
	const existing = new Set(
		[
			...summary.attributes,
			...summary.tabularSections,
			...summary.dimensions,
			...summary.resources,
			...summary.enumValues,
		].map((item) => item.name.toLowerCase()),
	);
	const incoming = spec.tabularSection
		? []
		: [
				...(spec.attributes ?? []),
				...(spec.tabularSections ?? []),
				...(spec.dimensions ?? []),
				...(spec.resources ?? []),
				...(spec.values ?? []),
			];
	const clash = incoming.find((item) => existing.has(item.name.toLowerCase()));
	if (clash) {
		throw new Error(`элемент «${clash.name}» уже есть в объекте`);
	}
}

function finish(project: EdtProject, writes: readonly PendingWrite[]): ChangeReport {
	const { created, modified } = applyWrites(writes);
	const context = createValidationContext(project);
	const diagnostics = writes
		.filter((write) => write.filePath.endsWith(".mdo"))
		.flatMap((write) => validateMdoText(context, write.filePath, write.text));
	const relative = (filePath: string): string => path.relative(project.root, filePath).split(path.sep).join("/");
	return { created: created.map(relative), modified: modified.map(relative), diagnostics };
}

function constantType(text: string, scaffold: ScaffoldKind, typeText: string | undefined): string {
	const parsed = parseTypeSpec(typeText ?? "");
	if (!parsed.ok) {
		throw new Error(`константа: ${parsed.error} (передайте options.type)`);
	}
	let result = insertTopLevel(text, scaffold.order, "type", renderTypeXml(parsed.parts, "  "));
	result = insertTopLevel(result, scaffold.order, "minValue", ['  <minValue xsi:type="core:UndefinedValue"/>']);
	return insertTopLevel(result, scaffold.order, "maxValue", ['  <maxValue xsi:type="core:UndefinedValue"/>']);
}

export function createObject(project: EdtProject, spec: CreateSpec): ChangeReport {
	// Создаёт объект метаданных со всеми файлами и регистрацией и возвращает изменения с диагностикой.
	const scaffold = requireScaffold(spec.ref);
	const filePath = objectFile(project, spec.ref.kind, spec.ref.name);
	if (fs.existsSync(filePath)) {
		throw new Error(`объект уже существует: ${path.relative(project.root, filePath)}; используйте action=add`);
	}
	const language = readConfigurationIndex(project)?.languageCode ?? "ru";
	const options = spec.options ?? {};
	let text = renderObjectSkeleton(
		spec.ref.kind.kind,
		spec.ref.name,
		spec.synonym ?? synonymFromName(spec.ref.name),
		language,
		scaffold.producedTypes,
		scaffold.properties(spec.ref.name, options),
		[],
	);
	if (spec.ref.kind.kind === "Constant") {
		text = constantType(text, scaffold, options.type);
	}
	text = applyChildren(text, project, spec.ref, scaffold, spec, language);
	const reference = `${spec.ref.kind.kind}.${spec.ref.name}`;
	const writes: PendingWrite[] = [{ filePath, text }];
	const registration = registrationWrite(project, spec.ref.kind, spec.ref.name);
	if (registration) writes.push(registration);
	const subsystem = spec.subsystem ? subsystemWrite(project, spec.subsystem, reference) : undefined;
	if (subsystem) writes.push(subsystem);
	const moduleFile = scaffold.modules[0];
	if (moduleFile) {
		const records = readMdo(text)?.registerRecords ?? [];
		writes.push({
			filePath: path.join(path.dirname(filePath), moduleFile),
			text: moduleTemplate(moduleFile, records),
		});
	}
	return finish(project, writes);
}

export function addToObject(
	project: EdtProject,
	ref: MdoRef,
	spec: ChildrenSpec & { readonly subsystem?: string },
): ChangeReport {
	const scaffold = requireScaffold(ref);
	const filePath = objectFile(project, ref.kind, ref.name);
	if (!fs.existsSync(filePath)) {
		throw new Error(`объект ${ref.kind.kind}.${ref.name} не найден; используйте action=create`);
	}
	const original = fs.readFileSync(filePath, "utf8");
	checkDuplicates(original, spec);
	const language = readConfigurationIndex(project)?.languageCode ?? "ru";
	const writes: PendingWrite[] = [{ filePath, text: applyChildren(original, project, ref, scaffold, spec, language) }];
	const subsystem = spec.subsystem
		? subsystemWrite(project, spec.subsystem, `${ref.kind.kind}.${ref.name}`)
		: undefined;
	if (subsystem) writes.push(subsystem);
	return finish(project, writes);
}
