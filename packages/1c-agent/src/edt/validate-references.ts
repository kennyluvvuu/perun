// Проверка ссылок .mdo на другие объекты конфигурации: типы реквизитов, движения документов, состав подсистем.

import * as fs from "node:fs";
import * as path from "node:path";
import { findKind, findKindByRefType } from "./metadata-kinds.ts";
import { readConfigurationIndex } from "./project-locator.ts";
import type { ConfigurationIndex, EdtProject, KindInfo, MdoDiagnostic, MdoField, MdoSummary } from "./types.ts";
import { lineOf } from "./xml-reader.ts";

export interface ValidationContext {
	readonly project: EdtProject;
	readonly configuration?: ConfigurationIndex;
	readonly exists: (kind: KindInfo, name: string) => boolean;
}

export function createValidationContext(project: EdtProject): ValidationContext {
	const cache = new Map<string, boolean>();
	return {
		project,
		configuration: readConfigurationIndex(project),
		exists: (kind, name) => {
			const key = `${kind.folder}/${name}`;
			const cached = cache.get(key);
			if (cached !== undefined) {
				return cached;
			}
			const found = fs.existsSync(path.join(project.srcDir, kind.folder, name, `${name}.mdo`));
			cache.set(key, found);
			return found;
		},
	};
}

function referencedObject(typeName: string): { readonly kind: KindInfo; readonly name: string } | undefined {
	const [head, name] = typeName.split(".");
	if (!name) {
		return undefined;
	}
	if (head === "DefinedType") {
		const kind = findKind("DefinedType");
		return kind ? { kind, name } : undefined;
	}
	if (head === "Characteristic") {
		const kind = findKind("ChartOfCharacteristicTypes");
		return kind ? { kind, name } : undefined;
	}
	const kind = findKindByRefType(head);
	return kind ? { kind, name } : undefined;
}

function metadataObject(reference: string): { readonly kind: KindInfo; readonly name: string } | undefined {
	const [head, name] = reference.split(".");
	const kind = head ? findKind(head) : undefined;
	return kind && name ? { kind, name } : undefined;
}

function fieldsOf(summary: MdoSummary): MdoField[] {
	return [
		...summary.attributes,
		...summary.dimensions,
		...summary.resources,
		...summary.tabularSections.flatMap((section) => section.attributes),
	];
}

export function checkReferences(
	context: ValidationContext,
	summary: MdoSummary,
	text: string,
	file: string,
): MdoDiagnostic[] {
	// Находит ссылки на несуществующие объекты в типах, движениях документа и составе подсистемы.
	const diagnostics: MdoDiagnostic[] = [];
	const report = (needle: string, message: string): void => {
		diagnostics.push({ file, line: lineOf(text, needle), severity: "error", message });
	};
	for (const field of fieldsOf(summary)) {
		for (const typeName of field.types) {
			const target = referencedObject(typeName);
			if (target && !context.exists(target.kind, target.name)) {
				report(
					`<types>${typeName}</types>`,
					`«${field.name}»: тип ${typeName} ссылается на несуществующий объект ${target.kind.folder}/${target.name}`,
				);
			}
		}
	}
	for (const reference of summary.registerRecords) {
		const target = metadataObject(reference);
		if (!target || !context.exists(target.kind, target.name)) {
			report(`<registerRecords>${reference}</registerRecords>`, `движения в несуществующий регистр ${reference}`);
		}
	}
	for (const reference of summary.content) {
		const target = metadataObject(reference);
		if (target && !context.exists(target.kind, target.name)) {
			report(`<content>${reference}</content>`, `в состав подсистемы включён несуществующий объект ${reference}`);
		}
	}
	return diagnostics;
}

export function checkRegisteredObjects(context: ValidationContext, text: string, file: string): MdoDiagnostic[] {
	const diagnostics: MdoDiagnostic[] = [];
	for (const reference of context.configuration?.registered ?? []) {
		const target = metadataObject(reference);
		if (target && target.kind.kind !== "Language" && !context.exists(target.kind, target.name)) {
			diagnostics.push({
				file,
				line: lineOf(text, `>${reference}<`),
				severity: "error",
				message: `объект ${reference} зарегистрирован, но файла ${target.kind.folder}/${target.name}/${target.name}.mdo нет`,
			});
		}
	}
	return diagnostics;
}
