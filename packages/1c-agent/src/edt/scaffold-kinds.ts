// Правила генерации объектов EDT по видам: producedTypes, свойства по умолчанию, порядок коллекций и модули.

import type { ObjectOptions } from "./types.ts";

export type FieldFlavor = "object" | "processor" | "accDimension" | "accResource" | "infoField" | "infoDimension";

export type ChildCollection = "attributes" | "tabularSections" | "dimensions" | "resources" | "enumValues";

export interface ScaffoldKind {
	readonly producedTypes: readonly string[];
	readonly order: readonly string[];
	readonly collections: Readonly<Partial<Record<ChildCollection, FieldFlavor>>>;
	readonly modules: readonly string[];
	readonly properties: (name: string, options: ObjectOptions) => ReadonlyArray<readonly [string, string]>;
}

const OBJECT_TYPES = ["objectType", "refType", "selectionType", "listType", "managerType"];
const REGISTER_TYPES = ["selectionType", "listType", "managerType", "recordSetType", "recordKeyType", "recordType"];
const HEAD = ["producedTypes", "name", "synonym", "comment"];

const COMMON_MODULE_FLAGS: Readonly<Record<NonNullable<ObjectOptions["context"]>, readonly string[]>> = {
	server: ["server", "externalConnection", "clientOrdinaryApplication"],
	serverCall: ["server", "serverCall"],
	client: ["clientManagedApplication", "clientOrdinaryApplication"],
	clientServer: ["clientManagedApplication", "server", "externalConnection", "clientOrdinaryApplication"],
	global: ["global", "clientManagedApplication", "clientOrdinaryApplication"],
};

export const SCAFFOLD_KINDS: Readonly<Record<string, ScaffoldKind>> = {
	Catalog: {
		producedTypes: OBJECT_TYPES,
		order: [...HEAD, "useStandardCommands", "attributes", "tabularSections", "forms", "templates", "commands"],
		collections: { attributes: "object", tabularSections: "object" },
		modules: ["ObjectModule.bsl", "ManagerModule.bsl"],
		properties: (name, options) => [
			["useStandardCommands", "true"],
			["inputByString", `Catalog.${name}.StandardAttribute.Code`],
			["inputByString", `Catalog.${name}.StandardAttribute.Description`],
			["fullTextSearchOnInputByString", "DontUse"],
			["createOnInput", "Use"],
			["dataLockControlMode", "Managed"],
			["fullTextSearch", "Use"],
			...(options.hierarchical ? ([["hierarchical", "true"]] as const) : []),
			["levelCount", "2"],
			["foldersOnTop", "true"],
			["codeLength", String(options.codeLength ?? 9)],
			["descriptionLength", String(options.descriptionLength ?? 100)],
			["codeType", "String"],
			["codeAllowedLength", "Variable"],
			["checkUnique", "true"],
			["autonumbering", "true"],
			["defaultPresentation", "AsDescription"],
			["editType", "InDialog"],
			["choiceMode", "BothWays"],
		],
	},
	Document: {
		producedTypes: OBJECT_TYPES,
		order: [
			...HEAD,
			"useStandardCommands",
			"registerRecords",
			"postInPrivilegedMode",
			"unpostInPrivilegedMode",
			"attributes",
			"forms",
			"tabularSections",
			"templates",
			"commands",
		],
		collections: { attributes: "object", tabularSections: "object" },
		modules: ["ObjectModule.bsl", "ManagerModule.bsl"],
		properties: (name, options) => [
			["useStandardCommands", "true"],
			["inputByString", `Document.${name}.StandardAttribute.Number`],
			["fullTextSearchOnInputByString", "DontUse"],
			["createOnInput", "Use"],
			["dataLockControlMode", "Managed"],
			["fullTextSearch", "Use"],
			["numberType", "String"],
			["numberLength", String(options.numberLength ?? 11)],
			["numberAllowedLength", "Variable"],
			["checkUnique", "true"],
			["autonumbering", "true"],
			["postInPrivilegedMode", "true"],
			["unpostInPrivilegedMode", "true"],
		],
	},
	Enum: {
		producedTypes: ["refType", "listType", "managerType"],
		order: [...HEAD, "useStandardCommands", "enumValues", "forms"],
		collections: { enumValues: "object" },
		modules: [],
		properties: () => [
			["useStandardCommands", "true"],
			["quickChoice", "true"],
			["choiceMode", "BothWays"],
		],
	},
	Constant: {
		producedTypes: ["managerType", "valueManagerType", "valueKeyType"],
		order: [...HEAD, "type", "useStandardCommands", "minValue", "maxValue", "dataLockControlMode"],
		collections: {},
		modules: [],
		properties: () => [
			["useStandardCommands", "true"],
			["dataLockControlMode", "Managed"],
		],
	},
	CommonModule: {
		producedTypes: [],
		order: [...HEAD],
		collections: {},
		modules: ["Module.bsl"],
		properties: (_name, options) =>
			COMMON_MODULE_FLAGS[options.context ?? "server"].map((flag) => [flag, "true"] as const),
	},
	InformationRegister: {
		producedTypes: [...REGISTER_TYPES, "recordManagerType"],
		order: [
			...HEAD,
			"useStandardCommands",
			"resources",
			"attributes",
			"dimensions",
			"forms",
			"templates",
			"commands",
		],
		collections: { resources: "infoField", attributes: "infoField", dimensions: "infoDimension" },
		modules: ["RecordSetModule.bsl"],
		properties: (_name, options) => [
			["useStandardCommands", "true"],
			["editType", "InDialog"],
			["informationRegisterPeriodicity", options.periodicity ?? "Nonperiodical"],
			["writeMode", options.writeMode ?? "Independent"],
			["dataLockControlMode", "Managed"],
		],
	},
	AccumulationRegister: {
		producedTypes: REGISTER_TYPES,
		order: [
			...HEAD,
			"useStandardCommands",
			"resources",
			"attributes",
			"dimensions",
			"forms",
			"templates",
			"commands",
		],
		collections: { resources: "accResource", attributes: "accResource", dimensions: "accDimension" },
		modules: ["RecordSetModule.bsl"],
		properties: (_name, options) => [
			["useStandardCommands", "true"],
			["registerType", options.registerType ?? "Balance"],
			["dataLockControlMode", "Managed"],
			["enableTotalsSplitting", "true"],
		],
	},
	DataProcessor: {
		producedTypes: ["objectType", "managerType"],
		order: [...HEAD, "useStandardCommands", "attributes", "tabularSections", "forms", "templates", "commands"],
		collections: { attributes: "processor", tabularSections: "processor" },
		modules: ["ObjectModule.bsl"],
		properties: () => [["useStandardCommands", "true"]],
	},
	Report: {
		producedTypes: ["objectType", "managerType"],
		order: [...HEAD, "useStandardCommands", "attributes", "tabularSections", "forms", "templates", "commands"],
		collections: { attributes: "processor", tabularSections: "processor" },
		modules: ["ObjectModule.bsl"],
		properties: () => [["useStandardCommands", "true"]],
	},
};

export function getScaffoldKind(kind: string): ScaffoldKind | undefined {
	// Возвращает правила генерации для вида метаданных или undefined, если вид не поддерживается.
	return SCAFFOLD_KINDS[kind];
}
