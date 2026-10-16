// Проверка всего EDT-проекта: каждый .mdo, согласованность с Configuration.mdo и уникальность UUID между файлами.

import * as fs from "node:fs";
import * as path from "node:path";
import { relativeToProject } from "./project-locator.ts";
import type { EdtProject, MdoDiagnostic } from "./types.ts";
import { validateMdoText } from "./validate-file.ts";
import { createValidationContext } from "./validate-references.ts";
import { lineAt } from "./xml-reader.ts";

export interface ProjectValidationResult {
	readonly files: number;
	readonly diagnostics: readonly MdoDiagnostic[];
}

export function listMdoFiles(srcDir: string): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		let entries: fs.Dirent[];
		try {
			entries = fs.readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(full);
			} else if (entry.name.endsWith(".mdo")) {
				files.push(full);
			}
		}
	};
	walk(srcDir);
	return files.sort();
}

export function validateProject(project: EdtProject): ProjectValidationResult {
	// Проверяет все .mdo проекта и ищет UUID, повторяющиеся в разных файлах.
	const context = createValidationContext(project);
	const diagnostics: MdoDiagnostic[] = [];
	const owners = new Map<string, string>();
	const files = listMdoFiles(project.srcDir);
	for (const filePath of files) {
		let text: string;
		try {
			text = fs.readFileSync(filePath, "utf8");
		} catch {
			continue;
		}
		diagnostics.push(...validateMdoText(context, filePath, text));
		const file = relativeToProject(project, filePath);
		for (const match of text.matchAll(/\b(?:uuid|typeId|valueTypeId)="([0-9a-fA-F-]{36})"/g)) {
			const key = match[1].toLowerCase();
			const owner = owners.get(key);
			if (owner !== undefined && owner !== file) {
				diagnostics.push({
					file,
					line: lineAt(text, match.index ?? 0),
					severity: "error",
					message: `UUID ${match[1]} уже используется в ${owner} (объект скопирован? сгенерируйте новые UUID)`,
				});
			} else {
				owners.set(key, file);
			}
		}
	}
	return { files: files.length, diagnostics };
}

export function formatDiagnostics(diagnostics: readonly MdoDiagnostic[], limit = 50): string {
	const lines = diagnostics
		.slice(0, limit)
		.map(
			(item) =>
				`${item.file}:${item.line}: ${item.severity === "error" ? "ошибка" : "предупреждение"}: ${item.message}`,
		);
	if (diagnostics.length > limit) {
		lines.push(`… и ещё ${diagnostics.length - limit}`);
	}
	return lines.join("\n");
}
