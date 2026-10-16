// Факты о проекте для системного промпта: EDT-проект, информационная база и найденные утилиты 1С.

import * as fs from "node:fs";
import * as path from "node:path";
import { readConfigurationIndex } from "../edt/project-locator.ts";
import { resolveEdtProject } from "../edt/tools.ts";
import { locatePlatformTools } from "../infobase/platform-locator.ts";
import { resolveInfobase } from "../infobase/project-config.ts";

const DESIGNER_DUMP_CANDIDATES = [
	"Configuration.xml",
	path.join("src", "Configuration.xml"),
	path.join("src", "cf", "Configuration.xml"),
];

function projectLine(cwd: string): string {
	const project = resolveEdtProject(cwd);
	if (project) {
		const index = readConfigurationIndex(project);
		const location = path.relative(cwd, project.root) || ".";
		return `- EDT-проект: ${location} · конфигурация «${index?.name ?? "?"}» · режим совместимости ${index?.compatibilityMode ?? "?"} · язык синонимов ${index?.languageCode ?? "ru"}`;
	}
	if (DESIGNER_DUMP_CANDIDATES.some((candidate) => fs.existsSync(path.join(cwd, candidate)))) {
		return "- Найдена выгрузка Конфигуратора (Configuration.xml), а не проект EDT: 1c_md с ней не работает, правь XML через read/edit.";
	}
	return "- EDT-проект в рабочем каталоге не найден.";
}

export function collectProjectFacts(cwd: string): string[] {
	// Собирает короткие факты о проекте и окружении, чтобы модель не искала их сама.
	const lines = [projectLine(cwd)];
	const infobase = resolveInfobase(cwd);
	if (typeof infobase === "string") {
		return [...lines, `- База: ${infobase}`];
	}
	const tools = locatePlatformTools(infobase.v8path);
	const mark = (value: string | undefined): string => (value ? "есть" : "нет");
	lines.push(
		`- База: ${infobase.id} (${infobase.source})`,
		`- Утилиты: 1C:EDT CLI — ${mark(tools.edtCli)}, ibcmd — ${mark(tools.ibcmd)}, Конфигуратор — ${mark(tools.designer)}, тонкий клиент — ${mark(tools.thinClient)}`,
	);
	if (!tools.edtCli) {
		lines.push(
			"- Без 1C:EDT CLI сборка в базу (1c_ib build) недоступна: проверяй метаданные через 1c_md validate и скажи пользователю, что сборку нужно выполнить в EDT.",
		);
	}
	return lines;
}
