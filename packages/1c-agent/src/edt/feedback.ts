// Проверка .mdo сразу после write/edit: замечания добавляются к результату инструмента, как диагностика bsl-analyzer.

import * as fs from "node:fs";
import * as path from "node:path";
import { findProjectForFile } from "./project-locator.ts";
import { validateMdoText } from "./validate-file.ts";
import { formatDiagnostics } from "./validate-project.ts";
import { createValidationContext } from "./validate-references.ts";

export function editedFilePath(toolName: string, input: unknown, cwd: string): string | undefined {
	if (toolName !== "write" && toolName !== "edit") {
		return undefined;
	}
	const record = typeof input === "object" && input !== null ? (input as { path?: unknown; file_path?: unknown }) : {};
	const raw =
		typeof record.path === "string"
			? record.path
			: typeof record.file_path === "string"
				? record.file_path
				: undefined;
	return raw ? path.resolve(cwd, raw) : undefined;
}

export function mdoFeedbackText(filePath: string): string | undefined {
	// Возвращает замечания по изменённому .mdo; undefined — файл не .mdo, вне EDT-проекта или без замечаний.
	if (!filePath.toLowerCase().endsWith(".mdo")) {
		return undefined;
	}
	const project = findProjectForFile(filePath);
	if (!project) {
		return undefined;
	}
	let text: string;
	try {
		text = fs.readFileSync(filePath, "utf8");
	} catch {
		return undefined;
	}
	const diagnostics = validateMdoText(createValidationContext(project), filePath, text);
	if (diagnostics.length === 0) {
		return undefined;
	}
	return `\n[проверка .mdo]: замечаний ${diagnostics.length} — исправь их следующим шагом\n${formatDiagnostics(diagnostics)}`;
}
