// Чтение модулей BSL прямо из рабочего каталога, когда проект не находится под git.
import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { DocsSource, SourceFile } from "./docs-source.ts";

const SKIP_DIRS = new Set([
	".git",
	"node_modules",
	"bin",
	"build",
	"dist",
	".idea",
	".vscode",
	".metadata",
	".settings",
]);

async function walk(root: string, relative: string, files: Map<string, string>): Promise<void> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(path.join(root, relative), { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const child = relative ? `${relative}/${entry.name}` : entry.name;
		if (entry.isDirectory()) {
			if (!SKIP_DIRS.has(entry.name.toLowerCase())) {
				await walk(root, child, files);
			}
		} else if (entry.isFile() && entry.name.toLowerCase().endsWith(".bsl")) {
			const stat = await fs.stat(path.join(root, child));
			files.set(child, `${stat.size}:${Math.trunc(stat.mtimeMs)}`);
		}
	}
}

export function createWorktreeSource(root: string): DocsSource {
	// Источник: файлы .bsl рабочего каталога, версия файла — размер и время изменения.
	const list = async () => {
		const files = new Map<string, string>();
		await walk(root, "", files);
		return files;
	};
	return {
		type: "worktree",
		root,
		revision: async () => {
			const files = await list();
			const digest = createHash("sha1");
			for (const [file, blob] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
				digest.update(`${file}\0${blob}\n`);
			}
			return `worktree:${digest.digest("hex").slice(0, 16)}`;
		},
		list,
		read: async (items: readonly SourceFile[]) => {
			const result = new Map<string, string>();
			for (const item of items) {
				const content = await fs.readFile(path.join(root, item.path), "utf8").catch(() => undefined);
				if (content !== undefined) {
					result.set(item.path, content);
				}
			}
			return result;
		},
	};
}
