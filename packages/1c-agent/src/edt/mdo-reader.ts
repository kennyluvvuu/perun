// Разбор файла .mdo в сводку объекта метаданных: реквизиты, табличные части, измерения, ресурсы, формы, движения.

import type { MdoField, MdoSummary, MdoTabularSection } from "./types.ts";
import {
	attributeOf,
	childElements,
	childText,
	childTexts,
	parseXml,
	rootElement,
	type XmlElement,
} from "./xml-reader.ts";

const SCALAR_PROPERTIES = [
	"registerType",
	"informationRegisterPeriodicity",
	"writeMode",
	"posting",
	"hierarchical",
	"codeLength",
	"descriptionLength",
	"numberLength",
	"global",
	"clientManagedApplication",
	"server",
	"externalConnection",
	"clientOrdinaryApplication",
	"serverCall",
	"privileged",
	"returnValuesReuse",
	"mainDataCompositionSchema",
	"compatibilityMode",
	"defaultLanguage",
] as const;

function synonymOf(element: XmlElement): string | undefined {
	const first = childElements(element, "synonym")[0];
	return first ? childText(first, "value") : undefined;
}

function qualifiedType(type: XmlElement, name: string): string {
	const qualifier = (key: string): XmlElement | undefined => childElements(type, key)[0];
	if (name === "String") {
		const length = Number(childText(qualifier("stringQualifiers") ?? {}, "length") ?? "0");
		return length > 0 ? `String(${length})` : "String(неогр.)";
	}
	if (name === "Number") {
		const numbers = qualifier("numberQualifiers") ?? {};
		const scale = childText(numbers, "scale") ?? "0";
		const sign = childText(numbers, "nonNegative") === "true" ? ",неотр" : "";
		return `Number(${childText(numbers, "precision") ?? "10"},${scale}${sign})`;
	}
	if (name === "Date") {
		const fractions = childText(qualifier("dateQualifiers") ?? {}, "dateFractions");
		return fractions ? `Date(${fractions})` : "Date";
	}
	return name;
}

function readField(element: XmlElement): MdoField {
	const type = childElements(element, "type")[0];
	const types = type ? childTexts(type, "types") : [];
	return {
		name: childText(element, "name") ?? "",
		uuid: attributeOf(element, "uuid") ?? "",
		types,
		typeText: type ? types.map((name) => qualifiedType(type, name)).join(" | ") : "",
		synonym: synonymOf(element),
	};
}

function readFields(element: XmlElement, key: string): MdoField[] {
	return childElements(element, key).map(readField);
}

function readNames(element: XmlElement, key: string): string[] {
	return childElements(element, key).map((child) => childText(child, "name") ?? "");
}

function readProducedTypeIds(element: XmlElement): string[] {
	const ids: string[] = [];
	for (const produced of childElements(element, "producedTypes")) {
		for (const [key, value] of Object.entries(produced)) {
			if (key.startsWith("@_") || key === "#text") {
				continue;
			}
			for (const typeElement of childElements({ [key]: value }, key)) {
				const typeId = attributeOf(typeElement, "typeId");
				const valueTypeId = attributeOf(typeElement, "valueTypeId");
				if (typeId) ids.push(typeId);
				if (valueTypeId) ids.push(valueTypeId);
			}
		}
	}
	return ids;
}

function readTabularSection(element: XmlElement): MdoTabularSection {
	return {
		name: childText(element, "name") ?? "",
		uuid: attributeOf(element, "uuid") ?? "",
		attributes: readFields(element, "attributes"),
	};
}

function readProperties(element: XmlElement): Record<string, string> {
	const properties: Record<string, string> = {};
	for (const key of SCALAR_PROPERTIES) {
		const value = childText(element, key);
		if (value !== undefined && value !== "") {
			properties[key] = value;
		}
	}
	return properties;
}

export function readMdo(text: string): MdoSummary | undefined {
	// Разбирает текст .mdo в сводку объекта; undefined — если корневой элемент не из пространства mdclass.
	const root = rootElement(parseXml(text));
	if (!root || !root.tag.startsWith("mdclass:")) {
		return undefined;
	}
	const element = root.element;
	const tabularSections = childElements(element, "tabularSections");
	const producedTypeIds = [
		...readProducedTypeIds(element),
		...tabularSections.flatMap((section) => readProducedTypeIds(section)),
	];
	return {
		kind: root.tag.slice("mdclass:".length),
		name: childText(element, "name") ?? "",
		uuid: attributeOf(element, "uuid") ?? "",
		synonym: synonymOf(element),
		attributes: readFields(element, "attributes"),
		tabularSections: tabularSections.map(readTabularSection),
		dimensions: readFields(element, "dimensions"),
		resources: readFields(element, "resources"),
		enumValues: readFields(element, "enumValues"),
		forms: readNames(element, "forms"),
		commands: readNames(element, "commands"),
		templates: readNames(element, "templates"),
		registerRecords: childTexts(element, "registerRecords"),
		content: childTexts(element, "content"),
		properties: readProperties(element),
		producedTypeIds,
	};
}
