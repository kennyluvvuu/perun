// Разбор вывода Конфигуратора и ibcmd в список замечаний с привязкой ошибок модулей к файлам src/ EDT-проекта.

import { findKind } from "../edt/metadata-kinds.ts";
import type { IbIssue } from "./types.ts";

const MODULE_ISSUE = /^\{([^}]+?)\((\d+),(\d+)\)\}:\s*(.+)$/u;
const ISSUE_MARKERS = /ошиб|error|неразрешим|не найден|fatal|предупрежд|warning/i;
const SUCCESS = /ошибок не обнаружено|errors not found/i;

const MODULE_FILES: Readonly<Record<string, string>> = {
	модуль: "Module.bsl",
	module: "Module.bsl",
	модульобъекта: "ObjectModule.bsl",
	objectmodule: "ObjectModule.bsl",
	модульменеджера: "ManagerModule.bsl",
	managermodule: "ManagerModule.bsl",
	модульнаборазаписей: "RecordSetModule.bsl",
	recordsetmodule: "RecordSetModule.bsl",
	модульменеджеразначения: "ValueManagerModule.bsl",
	valuemanagermodule: "ValueManagerModule.bsl",
	модулькоманды: "CommandModule.bsl",
	commandmodule: "CommandModule.bsl",
	модульсеанса: "SessionModule.bsl",
	sessionmodule: "SessionModule.bsl",
	модульуправляемогоприложения: "ManagedApplicationModule.bsl",
	managedapplicationmodule: "ManagedApplicationModule.bsl",
	модульвнешнегосоединения: "ExternalConnectionModule.bsl",
	externalconnectionmodule: "ExternalConnectionModule.bsl",
	форма: "Module.bsl",
	form: "Module.bsl",
};

const FORM = new Set(["форма", "form"]);
const COMMAND = new Set(["команда", "command"]);

function configurationModule(parts: readonly string[]): string | undefined {
	const head = parts[0]?.toLowerCase();
	const file = parts[1] ? MODULE_FILES[parts[1].toLowerCase()] : undefined;
	return (head === "конфигурация" || head === "configuration") && file ? `src/Configuration/${file}` : undefined;
}

export function moduleSourcePath(location: string): string | undefined {
	const parts = location.split(".");
	const configuration = configurationModule(parts);
	if (configuration) {
		return configuration;
	}
	const kind = parts[0] ? findKind(parts[0]) : undefined;
	if (!kind || !parts[1]) {
		return undefined;
	}
	const base = `src/${kind.folder}/${parts[1]}`;
	const rest = parts.slice(2).map((part) => part.toLowerCase());
	if (rest.length === 0) {
		return base;
	}
	if (rest.length >= 2 && FORM.has(rest[0])) {
		return `${base}/Forms/${parts[3]}/Module.bsl`;
	}
	if (rest.length >= 2 && COMMAND.has(rest[0])) {
		return `${base}/Commands/${parts[3]}/CommandModule.bsl`;
	}
	const file = MODULE_FILES[rest[0]];
	return file ? `${base}/${file}` : undefined;
}

export function parsePlatformOutput(output: string): IbIssue[] {
	// Извлекает из вывода платформы ошибки и предупреждения; ошибки модулей переводит в путь src/…:строка:колонка.
	const issues: IbIssue[] = [];
	const seen = new Set<string>();
	const push = (issue: IbIssue): void => {
		const key = `${issue.location}|${issue.message}`;
		if (!seen.has(key)) {
			seen.add(key);
			issues.push(issue);
		}
	};
	for (const raw of output.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || SUCCESS.test(line) || /^\{\d+\}\s*:/.test(line)) {
			continue;
		}
		const severity = /предупрежд|warning/i.test(line) ? "warning" : "error";
		const module = line.match(MODULE_ISSUE);
		if (module) {
			const source = moduleSourcePath(module[1]);
			const location = source ? `${source}:${module[2]}:${module[3]}` : `${module[1]}(${module[2]},${module[3]})`;
			push({ severity, location, message: module[4].trim() });
			continue;
		}
		if (ISSUE_MARKERS.test(line)) {
			const [head] = line.split(/\s+/, 1);
			const source = head ? moduleSourcePath(head) : undefined;
			push({ severity, location: source ?? "", message: source ? line.slice(head.length).trim() : line });
		}
	}
	return issues;
}

export function outputTail(text: string, maxLines = 30): string {
	const lines = text
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean);
	return lines.slice(-maxLines).join("\n");
}
