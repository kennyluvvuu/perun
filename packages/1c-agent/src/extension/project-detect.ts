// Быстрое определение, что каталог содержит проект 1С (модули BSL, Configuration.mdo/xml, настройки bsl-analyzer).

import * as fs from "node:fs";
import * as path from "node:path";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", ".idea", ".vscode", "bin", "build"]);
const MARKER_FILES = new Set(["configuration.mdo", "configuration.xml", "bsl-analyzer.toml", ".project"]);

async function checkDirectory(currentDir: string, currentDepth: number, maxDepth: number): Promise<boolean> {
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
	} catch {
		return false;
	}
	const subdirs: string[] = [];
	for (const entry of entries) {
		const lower = entry.name.toLowerCase();
		if (entry.isFile() || entry.isSymbolicLink()) {
			if (lower.endsWith(".bsl") || lower.endsWith(".os") || MARKER_FILES.has(lower)) {
				return true;
			}
		} else if (entry.isDirectory() && !SKIP_DIRS.has(lower) && currentDepth < maxDepth) {
			subdirs.push(path.join(currentDir, entry.name));
		}
	}
	for (const subdir of subdirs) {
		if (await checkDirectory(subdir, currentDepth + 1, maxDepth)) {
			return true;
		}
	}
	return false;
}

export async function detect1cProject(directory: string, maxDepth = 2): Promise<boolean> {
	// Проверяет каталог на признаки проекта 1С до заданной глубины вложенности.
	try {
		return await checkDirectory(directory, 0, maxDepth);
	} catch {
		return false;
	}
}
