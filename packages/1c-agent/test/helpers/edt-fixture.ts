// Создание минимального EDT-проекта во временном каталоге для тестов модулей edt и infobase.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { findEdtProjects } from "../../src/edt/project-locator.ts";
import type { EdtProject } from "../../src/edt/types.ts";

const CONFIGURATION = `<?xml version="1.0" encoding="UTF-8"?>
<mdclass:Configuration xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass" uuid="5b0a9f1e-3c2d-4e5f-8a9b-0c1d2e3f4a5b">
  <name>ТестоваяКонфигурация</name>
  <synonym>
    <key>ru</key>
    <value>Тестовая конфигурация</value>
  </synonym>
  <defaultRunMode>ManagedApplication</defaultRunMode>
  <defaultLanguage>Language.Русский</defaultLanguage>
  <dataLockControlMode>Managed</dataLockControlMode>
  <compatibilityMode>8.3.27</compatibilityMode>
  <languages uuid="6c1b0a2f-4d3e-4f60-9b0c-1d2e3f4a5b6c">
    <name>Русский</name>
    <synonym>
      <key>ru</key>
      <value>Русский</value>
    </synonym>
    <languageCode>ru</languageCode>
  </languages>
  <subsystems>Subsystem.Склад</subsystems>
</mdclass:Configuration>
`;

const SUBSYSTEM = `<?xml version="1.0" encoding="UTF-8"?>
<mdclass:Subsystem xmlns:mdclass="http://g5.1c.ru/v8/dt/metadata/mdclass" uuid="7d2c1b3a-5e4f-4071-8c1d-2e3f4a5b6c7d">
  <name>Склад</name>
  <synonym>
    <key>ru</key>
    <value>Склад</value>
  </synonym>
  <includeInCommandInterface>true</includeInCommandInterface>
</mdclass:Subsystem>
`;

export interface EdtFixture {
	readonly workspace: string;
	readonly project: EdtProject;
	readonly cleanup: () => void;
	readonly write: (relativePath: string, text: string) => string;
	readonly read: (relativePath: string) => string;
}

export function createEdtFixture(): EdtFixture {
	// Создаёт во временном каталоге EDT-проект с конфигурацией и подсистемой «Склад».
	const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "perun-edt-"));
	const root = path.join(workspace, "configuration");
	const write = (relativePath: string, text: string): string => {
		const full = path.join(root, relativePath);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text, "utf8");
		return full;
	};
	write(".project", "<projectDescription><name>configuration</name></projectDescription>\n");
	write("DT-INF/PROJECT.PMF", "Manifest-Version: 1.0\nRuntime-Version: 8.3.27\n");
	write("src/Configuration/Configuration.mdo", CONFIGURATION);
	write("src/Subsystems/Склад/Склад.mdo", SUBSYSTEM);
	const [project] = findEdtProjects(workspace);
	if (!project) {
		throw new Error("fixture project not found");
	}
	return {
		workspace,
		project,
		cleanup: () => fs.rmSync(workspace, { recursive: true, force: true }),
		write,
		read: (relativePath: string) => fs.readFileSync(path.join(root, relativePath), "utf8"),
	};
}
