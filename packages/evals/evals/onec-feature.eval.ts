// Сквозная проверка ПерУН на 1С-задаче: агент добавляет регистр и документ с проведением в EDT-проект без ошибок .mdo.

import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { findEdtProjects } from "../../1c-agent/src/edt/project-locator.ts";
import { validateProject } from "../../1c-agent/src/edt/validate-project.ts";
import { createOnecAgentExtension } from "../../1c-agent/src/index.ts";
import { createPiCodingAgentHarness } from "../src/harness.ts";

const SYNONYM = (value: string): string => `  <synonym>\n    <key>ru</key>\n    <value>${value}</value>\n  </synonym>`;

const WORKSPACE: Readonly<Record<string, string>> = {
	"configuration/.project": "<projectDescription><name>configuration</name></projectDescription>\n",
	"configuration/DT-INF/PROJECT.PMF": "Manifest-Version: 1.0\nRuntime-Version: 8.3.27\n",
	"configuration/src/Configuration/Configuration.mdo": [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<mdclass:Configuration xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass" uuid="5b0a9f1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b">',
		"  <name>Склад</name>",
		SYNONYM("Склад"),
		"  <defaultLanguage>Language.Русский</defaultLanguage>",
		"  <dataLockControlMode>Managed</dataLockControlMode>",
		"  <compatibilityMode>8.3.27</compatibilityMode>",
		'  <languages uuid="6c1b0a2f-4d3e-4f60-9b0c-1d2e3f4a5b6c">',
		"    <name>Русский</name>",
		"    <languageCode>ru</languageCode>",
		"  </languages>",
		"  <catalogs>Catalog.Товары</catalogs>",
		"</mdclass:Configuration>",
		"",
	].join("\n"),
	"configuration/src/Catalogs/Товары/Товары.mdo": [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<mdclass:Catalog xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:core="http://g5.1c.ru/v8/dt/mcore" xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass" uuid="8e3d2c4b-6f50-4182-9d2e-3f4a5b6c7d8e">',
		"  <producedTypes>",
		'    <objectType typeId="9f4e3d5c-7061-4293-8e3f-4a5b6c7d8e9f" valueTypeId="a05f4e6d-8172-43a4-9f40-5b6c7d8e9fa0"/>',
		'    <refType typeId="b1605f7e-9283-44b5-8051-6c7d8e9fa0b1" valueTypeId="c2716080-a394-45c6-9162-7d8e9fa0b1c2"/>',
		'    <selectionType typeId="d3827191-b4a5-46d7-a273-8e9fa0b1c2d3" valueTypeId="e49382a2-c5b6-47e8-b384-9fa0b1c2d3e4"/>',
		'    <listType typeId="f5a493b3-d6c7-48f9-8495-a0b1c2d3e4f5" valueTypeId="06b5a4c4-e7d8-490a-95a6-b1c2d3e4f506"/>',
		'    <managerType typeId="17c6b5d5-f8e9-4a1b-a6b7-c2d3e4f50617" valueTypeId="28d7c6e6-09fa-4b2c-b7c8-d3e4f5061728"/>',
		"  </producedTypes>",
		"  <name>Товары</name>",
		SYNONYM("Товары"),
		"  <useStandardCommands>true</useStandardCommands>",
		"</mdclass:Catalog>",
		"",
	].join("\n"),
};

const TASK =
	"Добавь в конфигурацию регистр накопления ОстаткиТоваров (остатки; измерение Товар — СправочникСсылка.Товары, ресурс Количество — Число(15,3)) " +
	"и документ ПоступлениеТоваров с табличной частью Товары (Товар, Количество). При проведении документ должен делать приход по регистру. " +
	"Сборка в базу не требуется. В конце коротко перечисли созданные объекты.";

type FeatureOutcome = {
	diagnostics: string[];
	registerExists: boolean;
	documentExists: boolean;
	postingWritesRegister: boolean;
	usedMetadataTool: boolean;
};

const harness = createPiCodingAgentHarness<FeatureOutcome>({
	name: "perun-1c-feature",
	extensions: [{ name: "perun-1c", factory: (pi) => void createOnecAgentExtension()(pi) }],
	workspaceFiles: WORKSPACE,
	output: ({ session }) => {
		const workspace = session.sessionManager.getCwd();
		const [project] = findEdtProjects(workspace);
		const src = project ? project.srcDir : path.join(workspace, "configuration", "src");
		const module = path.join(src, "Documents", "ПоступлениеТоваров", "ObjectModule.bsl");
		const moduleText = fs.existsSync(module) ? fs.readFileSync(module, "utf8") : "";
		const toolNames = session.messages.flatMap((message) =>
			message.role === "assistant" ? message.content.filter((part) => part.type === "toolCall").map((part) => part.name) : [],
		);
		return {
			diagnostics: project ? validateProject(project).diagnostics.map((item) => `${item.file}:${item.line}: ${item.message}`) : ["нет проекта"],
			registerExists: fs.existsSync(path.join(src, "AccumulationRegisters", "ОстаткиТоваров", "ОстаткиТоваров.mdo")),
			documentExists: fs.existsSync(path.join(src, "Documents", "ПоступлениеТоваров", "ПоступлениеТоваров.mdo")),
			postingWritesRegister: /ОбработкаПроведения/.test(moduleText) && /Движения\.ОстаткиТоваров/.test(moduleText),
			usedMetadataTool: toolNames.includes("1c_md"),
		};
	},
});

describeEval("PerUN: 1C feature in EDT project", { harness }, (it) => {
	it("creates register and posting document with valid metadata", async ({ run }) => {
		const result = await run(TASK);
		expect(result.errors).toEqual([]);
		expect(result.output.diagnostics).toEqual([]);
		expect(result.output.registerExists).toBe(true);
		expect(result.output.documentExists).toBe(true);
		expect(result.output.postingWritesRegister).toBe(true);
		expect(result.output.usedMetadataTool).toBe(true);
	});
});
