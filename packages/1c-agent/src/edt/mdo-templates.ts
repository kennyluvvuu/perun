// Генерация XML-фрагментов .mdo: каркас объекта, producedTypes, реквизиты, табличные части и значения перечислений.

import { randomUUID } from "node:crypto";
import type { FieldFlavor } from "./scaffold-kinds.ts";
import { renderTypeXml, type TypePart } from "./type-spec.ts";
import type { FieldSpec } from "./types.ts";
import { escapeXml } from "./xml-reader.ts";

export const ROOT_NAMESPACES =
	'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:core="http://g5.1c.ru/v8/dt/mcore" xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass"';

const UNDEFINED_VALUE = 'xsi:type="core:UndefinedValue"';

export interface ParsedField {
	readonly spec: FieldSpec;
	readonly parts: readonly TypePart[];
}

export function synonymFromName(name: string): string {
	return name
		.replace(
			/([a-zа-яё0-9])([A-ZА-ЯЁ])(?=[a-zа-яё])/gu,
			(_match, left: string, right: string) => `${left} ${right.toLowerCase()}`,
		)
		.replace(/([a-zа-яё])([A-ZА-ЯЁ])/gu, "$1 $2");
}

export function synonymLines(indent: string, language: string, value: string): string[] {
	return [
		`${indent}<synonym>`,
		`${indent}  <key>${language}</key>`,
		`${indent}  <value>${escapeXml(value)}</value>`,
		`${indent}</synonym>`,
	];
}

export function producedTypesLines(indent: string, types: readonly string[]): string[] {
	if (types.length === 0) {
		return [];
	}
	return [
		`${indent}<producedTypes>`,
		...types.map((type) => `${indent}  <${type} typeId="${randomUUID()}" valueTypeId="${randomUUID()}"/>`),
		`${indent}</producedTypes>`,
	];
}

function flavorTail(flavor: FieldFlavor, spec: FieldSpec, inner: string): string[] {
	const required = spec.required ? [`${inner}<fillChecking>ShowError</fillChecking>`] : [];
	const indexed = spec.indexed ? [`${inner}<indexing>Index</indexing>`] : [];
	const fillValue = `${inner}<fillValue ${UNDEFINED_VALUE}/>`;
	switch (flavor) {
		case "object":
			return [
				...required,
				fillValue,
				...indexed,
				`${inner}<fullTextSearch>Use</fullTextSearch>`,
				`${inner}<dataHistory>Use</dataHistory>`,
			];
		case "processor":
			return required;
		case "accDimension":
			return [
				...required,
				...indexed,
				`${inner}<fullTextSearch>Use</fullTextSearch>`,
				`${inner}<useInTotals>true</useInTotals>`,
			];
		case "accResource":
			return [...indexed, `${inner}<fullTextSearch>Use</fullTextSearch>`];
		case "infoField":
			return [
				...required,
				...indexed,
				`${inner}<fullTextSearch>Use</fullTextSearch>`,
				`${inner}<dataHistory>Use</dataHistory>`,
				fillValue,
			];
		case "infoDimension":
			return [
				...required,
				`${inner}<fullTextSearch>Use</fullTextSearch>`,
				`${inner}<dataHistory>Use</dataHistory>`,
				fillValue,
				`${inner}<mainFilter>true</mainFilter>`,
			];
	}
}

export function renderField(
	tag: string,
	flavor: FieldFlavor,
	field: ParsedField,
	indent: string,
	language: string,
): string[] {
	// Формирует XML-блок реквизита, измерения или ресурса с типом и свойствами, принятыми в EDT.
	const inner = `${indent}  `;
	return [
		`${indent}<${tag} uuid="${randomUUID()}">`,
		`${inner}<name>${field.spec.name}</name>`,
		...synonymLines(inner, language, field.spec.synonym ?? synonymFromName(field.spec.name)),
		...renderTypeXml(field.parts, inner),
		`${inner}<minValue ${UNDEFINED_VALUE}/>`,
		`${inner}<maxValue ${UNDEFINED_VALUE}/>`,
		...flavorTail(flavor, field.spec, inner),
		`${indent}</${tag}>`,
	];
}

export function renderEnumValue(spec: FieldSpec, indent: string, language: string): string[] {
	return [
		`${indent}<enumValues uuid="${randomUUID()}">`,
		`${indent}  <name>${spec.name}</name>`,
		...synonymLines(`${indent}  `, language, spec.synonym ?? synonymFromName(spec.name)),
		`${indent}</enumValues>`,
	];
}

export function renderTabularSection(
	name: string,
	synonym: string | undefined,
	flavor: FieldFlavor,
	fields: readonly ParsedField[],
	indent: string,
	language: string,
): string[] {
	const inner = `${indent}  `;
	return [
		`${indent}<tabularSections uuid="${randomUUID()}">`,
		...producedTypesLines(inner, ["objectType", "rowType"]),
		`${inner}<name>${name}</name>`,
		...synonymLines(inner, language, synonym ?? synonymFromName(name)),
		...fields.flatMap((field) => renderField("attributes", flavor, field, inner, language)),
		`${indent}</tabularSections>`,
	];
}

export function renderObjectSkeleton(
	kind: string,
	name: string,
	synonym: string,
	language: string,
	producedTypes: readonly string[],
	properties: ReadonlyArray<readonly [string, string]>,
	extraLines: readonly string[],
): string {
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<mdclass:${kind} ${ROOT_NAMESPACES} uuid="${randomUUID()}">`,
		...producedTypesLines("  ", producedTypes),
		`  <name>${name}</name>`,
		...synonymLines("  ", language, synonym),
		...properties.map(([tag, value]) => `  <${tag}>${escapeXml(value)}</${tag}>`),
		...extraLines,
		`</mdclass:${kind}>`,
		"",
	].join("\n");
}
