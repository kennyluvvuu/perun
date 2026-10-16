// Регистрация объектов в Configuration.mdo и подсистемах, нормализация ссылок на регистры и атомарная запись файлов.

import * as fs from "node:fs";
import * as path from "node:path";
import { CONFIGURATION_ORDER } from "./configuration-order.ts";
import { findKind } from "./metadata-kinds.ts";
import type { EdtProject, KindInfo } from "./types.ts";
import { hasTopLevelValue, insertTopLevel } from "./xml-insert.ts";

export interface PendingWrite {
	readonly filePath: string;
	readonly text: string;
}

const SUBSYSTEM_ORDER = [
	"name",
	"synonym",
	"comment",
	"includeHelpInContents",
	"includeInCommandInterface",
	"explanation",
	"picture",
	"content",
	"subsystems",
	"parentSubsystem",
];

const REGISTER_KINDS = new Set([
	"AccumulationRegister",
	"InformationRegister",
	"AccountingRegister",
	"CalculationRegister",
]);

export function objectFile(project: EdtProject, kind: KindInfo, name: string): string {
	return path.join(project.srcDir, kind.folder, name, `${name}.mdo`);
}

export function registrationWrite(project: EdtProject, kind: KindInfo, name: string): PendingWrite | undefined {
	// Готовит изменённый Configuration.mdo с регистрацией объекта; undefined — объект уже зарегистрирован.
	if (!kind.collection) {
		throw new Error(`не знаю, в какую коллекцию Configuration.mdo регистрировать вид ${kind.kind}`);
	}
	const text = fs.readFileSync(project.configurationFile, "utf8");
	const value = `${kind.kind}.${name}`;
	if (hasTopLevelValue(text, kind.collection, value)) {
		return undefined;
	}
	const line = `  <${kind.collection}>${value}</${kind.collection}>`;
	return {
		filePath: project.configurationFile,
		text: insertTopLevel(text, CONFIGURATION_ORDER, kind.collection, [line]),
	};
}

export function subsystemWrite(project: EdtProject, subsystem: string, reference: string): PendingWrite | undefined {
	const parts = subsystem.split(/[/.]/).filter(Boolean);
	if (parts.length === 0) {
		throw new Error("не указано имя подсистемы");
	}
	const segments = parts.flatMap((part) => ["Subsystems", part]);
	const filePath = path.join(project.srcDir, ...segments, `${parts[parts.length - 1]}.mdo`);
	if (!fs.existsSync(filePath)) {
		throw new Error(`подсистема «${subsystem}» не найдена (${path.relative(project.root, filePath)})`);
	}
	const text = fs.readFileSync(filePath, "utf8");
	if (hasTopLevelValue(text, "content", reference)) {
		return undefined;
	}
	return { filePath, text: insertTopLevel(text, SUBSYSTEM_ORDER, "content", [`  <content>${reference}</content>`]) };
}

export function normalizeRegisterRecords(project: EdtProject, references: readonly string[]): string[] {
	return references.map((reference) => {
		const [head, name] = reference.split(".");
		const kind = head ? findKind(head) : undefined;
		if (!kind || !name || !REGISTER_KINDS.has(kind.kind)) {
			throw new Error(`«${reference}» — не регистр; ожидается например РегистрНакопления.Остатки`);
		}
		if (!fs.existsSync(objectFile(project, kind, name))) {
			throw new Error(`регистр ${kind.kind}.${name} не найден — сначала создайте его`);
		}
		return `${kind.kind}.${name}`;
	});
}

export function applyWrites(writes: readonly PendingWrite[]): { created: string[]; modified: string[] } {
	const created: string[] = [];
	const modified: string[] = [];
	for (const write of writes) {
		const existed = fs.existsSync(write.filePath);
		fs.mkdirSync(path.dirname(write.filePath), { recursive: true });
		fs.writeFileSync(write.filePath, write.text, "utf8");
		(existed ? modified : created).push(write.filePath);
	}
	return { created, modified };
}
