// Сборка XML-блоков дочерних элементов объекта (реквизиты, ТЧ, измерения, ресурсы, значения) из спецификации.

import { type ParsedField, renderEnumValue, renderField, renderTabularSection } from "./mdo-templates.ts";
import type { ChildCollection, ScaffoldKind } from "./scaffold-kinds.ts";
import { parseTypeSpec } from "./type-spec.ts";
import type { ChildrenSpec, FieldSpec } from "./types.ts";

export interface ChildBlock {
	readonly tag: ChildCollection;
	readonly lines: readonly string[];
}

export interface ChildBuild {
	readonly blocks: readonly ChildBlock[];
	readonly tabularLines: readonly string[];
	readonly errors: readonly string[];
}

const DEFAULT_TYPES: Readonly<Partial<Record<ChildCollection, string>>> = {
	resources: "Число(15,2)",
};

function parseFields(fields: readonly FieldSpec[], collection: ChildCollection, errors: string[]): ParsedField[] {
	const parsed: ParsedField[] = [];
	for (const spec of fields) {
		const typeText = spec.type ?? DEFAULT_TYPES[collection];
		if (!typeText) {
			errors.push(`«${spec.name}»: не указан тип`);
			continue;
		}
		const type = parseTypeSpec(typeText);
		if (!type.ok) {
			errors.push(`«${spec.name}»: ${type.error}`);
			continue;
		}
		parsed.push({ spec, parts: type.parts });
	}
	return parsed;
}

function unsupported(collection: ChildCollection, kind: string, errors: string[]): void {
	errors.push(`у объекта вида ${kind} нет коллекции ${collection}`);
}

export function buildChildren(kind: string, scaffold: ScaffoldKind, spec: ChildrenSpec, language: string): ChildBuild {
	// Превращает спецификацию дочерних элементов в XML-блоки с проверкой типов и допустимости коллекций.
	const errors: string[] = [];
	const blocks: ChildBlock[] = [];
	const simple: ReadonlyArray<readonly [ChildCollection, readonly FieldSpec[] | undefined]> = [
		["attributes", spec.tabularSection ? undefined : spec.attributes],
		["dimensions", spec.dimensions],
		["resources", spec.resources],
	];
	for (const [collection, fields] of simple) {
		if (!fields || fields.length === 0) continue;
		const flavor = scaffold.collections[collection];
		if (!flavor) {
			unsupported(collection, kind, errors);
			continue;
		}
		for (const field of parseFields(fields, collection, errors)) {
			blocks.push({ tag: collection, lines: renderField(collection, flavor, field, "  ", language) });
		}
	}
	if (spec.values && spec.values.length > 0) {
		if (scaffold.collections.enumValues) {
			for (const value of spec.values)
				blocks.push({ tag: "enumValues", lines: renderEnumValue(value, "  ", language) });
		} else {
			unsupported("enumValues", kind, errors);
		}
	}
	for (const section of spec.tabularSections ?? []) {
		const flavor = scaffold.collections.tabularSections;
		if (!flavor) {
			unsupported("tabularSections", kind, errors);
			break;
		}
		const fields = parseFields(section.attributes ?? [], "attributes", errors);
		blocks.push({
			tag: "tabularSections",
			lines: renderTabularSection(section.name, section.synonym, flavor, fields, "  ", language),
		});
	}
	const tabularLines: string[] = [];
	if (spec.tabularSection && spec.attributes) {
		const flavor = scaffold.collections.tabularSections;
		if (flavor) {
			for (const field of parseFields(spec.attributes, "attributes", errors)) {
				tabularLines.push(...renderField("attributes", flavor, field, "    ", language));
			}
		} else {
			unsupported("tabularSections", kind, errors);
		}
	}
	if (kind === "AccumulationRegister") {
		for (const field of spec.resources ?? []) {
			if (field.type && !/^(число|number)/i.test(field.type.trim())) {
				errors.push(`ресурс «${field.name}» регистра накопления должен быть числом`);
			}
		}
	}
	return { blocks, tabularLines, errors };
}
