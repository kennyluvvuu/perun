// Чтение XML-файлов EDT: синтаксическая проверка с позицией ошибки и типизированный доступ к дереву разбора.

import { XMLParser } from "fast-xml-parser";
import { SyntaxValidator } from "fast-xml-validator";

export interface XmlElement {
	readonly [key: string]: unknown;
}

export interface XmlSyntaxError {
	readonly line: number;
	readonly column: number;
	readonly message: string;
}

const parser = new XMLParser({
	ignoreAttributes: false,
	attributeNamePrefix: "@_",
	parseTagValue: false,
	parseAttributeValue: false,
	trimValues: true,
});

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function checkXmlSyntax(text: string): XmlSyntaxError | undefined {
	// Возвращает первую синтаксическую ошибку XML или undefined, если документ корректен.
	try {
		SyntaxValidator.validate(text);
		return undefined;
	} catch (error: unknown) {
		const details = isRecord(error) ? error : {};
		return {
			line: typeof details.line === "number" ? details.line : 1,
			column: typeof details.col === "number" ? details.col : 1,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

export function parseXml(text: string): XmlElement {
	const parsed: unknown = parser.parse(text);
	return isRecord(parsed) ? parsed : {};
}

export function rootElement(document: XmlElement): { readonly tag: string; readonly element: XmlElement } | undefined {
	for (const [tag, value] of Object.entries(document)) {
		if (tag.startsWith("?")) {
			continue;
		}
		return { tag, element: isRecord(value) ? value : {} };
	}
	return undefined;
}

export function childElements(element: XmlElement, key: string): XmlElement[] {
	const value = element[key];
	const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
	return items.map((item) => (isRecord(item) ? item : { "#text": String(item) }));
}

function asText(value: unknown): string | undefined {
	if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (isRecord(value)) {
		const inner = value["#text"];
		return inner === undefined ? "" : String(inner);
	}
	return undefined;
}

export function childTexts(element: XmlElement, key: string): string[] {
	const value = element[key];
	const items = Array.isArray(value) ? value : value === undefined ? [] : [value];
	return items.map(asText).filter((item): item is string => item !== undefined);
}

export function childText(element: XmlElement, key: string): string | undefined {
	return childTexts(element, key)[0];
}

export function attributeOf(element: XmlElement, name: string): string | undefined {
	const value = element[`@_${name}`];
	return value === undefined ? undefined : String(value);
}

export function lineAt(text: string, index: number): number {
	if (index <= 0) {
		return 1;
	}
	let line = 1;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text.charCodeAt(i) === 10) {
			line++;
		}
	}
	return line;
}

export function lineOf(text: string, needle: string, fromIndex = 0): number {
	const index = text.indexOf(needle, fromIndex);
	return index < 0 ? 1 : lineAt(text, index);
}

export function escapeXml(value: string): string {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
