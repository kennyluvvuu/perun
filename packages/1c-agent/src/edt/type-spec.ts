// Разбор описания типа реквизита («Строка(50)», «Число(15,2,неотр)», «СправочникСсылка.Товары|Дата») в XML-тип EDT.

import { findKind, findKindByRefType } from "./metadata-kinds.ts";

export type DateFractions = "Date" | "DateTime" | "Time";

export interface TypePart {
	readonly name: string;
	readonly length?: number;
	readonly precision?: number;
	readonly scale?: number;
	readonly nonNegative?: boolean;
	readonly dateFractions?: DateFractions;
}

export type ParsedType =
	| { readonly ok: true; readonly parts: readonly TypePart[] }
	| { readonly ok: false; readonly error: string };

const PRIMITIVES: Readonly<Record<string, TypePart>> = {
	string: { name: "String", length: 100 },
	строка: { name: "String", length: 100 },
	number: { name: "Number", precision: 10, scale: 0 },
	число: { name: "Number", precision: 10, scale: 0 },
	boolean: { name: "Boolean" },
	булево: { name: "Boolean" },
	date: { name: "Date", dateFractions: "Date" },
	дата: { name: "Date", dateFractions: "Date" },
	datetime: { name: "Date", dateFractions: "DateTime" },
	датавремя: { name: "Date", dateFractions: "DateTime" },
	time: { name: "Date", dateFractions: "Time" },
	время: { name: "Date", dateFractions: "Time" },
	valuestorage: { name: "ValueStorage" },
	хранилищезначения: { name: "ValueStorage" },
	uuid: { name: "UUID" },
	уникальныйидентификатор: { name: "UUID" },
};

const NON_NEGATIVE = new Set(["неотр", "неотрицательное", "nonneg", "nonnegative"]);

function withArguments(base: TypePart, args: readonly string[]): TypePart | string {
	const numbers = args.filter((arg) => /^\d+$/.test(arg)).map(Number);
	if (base.name === "String") {
		return { name: "String", length: numbers[0] ?? base.length };
	}
	if (base.name === "Number") {
		const precision = numbers[0] ?? base.precision ?? 10;
		const scale = numbers[1] ?? 0;
		if (precision < 1 || precision > 38 || scale > precision) {
			return `некорректная разрядность числа: ${precision},${scale}`;
		}
		return { name: "Number", precision, scale, nonNegative: args.some((arg) => NON_NEGATIVE.has(arg.toLowerCase())) };
	}
	return base;
}

function parseReference(head: string, tail: string): TypePart | string {
	const key = head.toLowerCase();
	if (key === "definedtype" || key === "определяемыйтип") {
		return { name: `DefinedType.${tail}` };
	}
	if (key === "characteristic" || key === "характеристика") {
		return { name: `Characteristic.${tail}` };
	}
	const kind = findKindByRefType(head) ?? findKind(head);
	if (!kind?.refType) {
		return `тип «${head}.${tail}» не является ссылочным; используйте например СправочникСсылка.${tail}`;
	}
	return { name: `${kind.refType}.${tail}` };
}

function parsePart(raw: string): TypePart | string {
	const match = raw.trim().match(/^([^\s(.]+)(?:\.([^\s(]+))?\s*(?:\(([^)]*)\))?$/u);
	if (!match) {
		return `не удалось разобрать тип «${raw.trim()}»`;
	}
	const [, head, tail, argText] = match;
	if (tail) {
		return parseReference(head, tail);
	}
	const base = PRIMITIVES[head.toLowerCase()];
	if (!base) {
		return `неизвестный тип «${head}»`;
	}
	const args = (argText ?? "")
		.split(",")
		.map((arg) => arg.trim())
		.filter(Boolean);
	return withArguments(base, args);
}

export function parseTypeSpec(spec: string): ParsedType {
	// Разбирает описание типа (части через «|») в список типов EDT с квалификаторами.
	const parts: TypePart[] = [];
	for (const raw of spec.split("|")) {
		if (!raw.trim()) {
			continue;
		}
		const part = parsePart(raw);
		if (typeof part === "string") {
			return { ok: false, error: part };
		}
		parts.push(part);
	}
	return parts.length > 0 ? { ok: true, parts } : { ok: false, error: "тип не указан" };
}

export function renderTypeXml(parts: readonly TypePart[], indent: string): string[] {
	const inner = `${indent}  `;
	const deep = `${inner}  `;
	const lines = [`${indent}<type>`, ...parts.map((part) => `${inner}<types>${part.name}</types>`)];
	const number = parts.find((part) => part.name === "Number");
	if (number) {
		lines.push(`${inner}<numberQualifiers>`, `${deep}<precision>${number.precision ?? 10}</precision>`);
		if (number.scale) lines.push(`${deep}<scale>${number.scale}</scale>`);
		if (number.nonNegative) lines.push(`${deep}<nonNegative>true</nonNegative>`);
		lines.push(`${inner}</numberQualifiers>`);
	}
	const text = parts.find((part) => part.name === "String");
	if (text) {
		lines.push(
			...(text.length
				? [`${inner}<stringQualifiers>`, `${deep}<length>${text.length}</length>`, `${inner}</stringQualifiers>`]
				: [`${inner}<stringQualifiers/>`]),
		);
	}
	const date = parts.find((part) => part.name === "Date");
	if (date) {
		lines.push(
			`${inner}<dateQualifiers>`,
			`${deep}<dateFractions>${date.dateFractions ?? "Date"}</dateFractions>`,
			`${inner}</dateQualifiers>`,
		);
	}
	lines.push(`${indent}</type>`);
	return lines;
}
