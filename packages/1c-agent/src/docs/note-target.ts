// Привязка заметки к коду: нормализация идентификатора и хэш символа по текущему файлу рабочего каталога.
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { buildModuleOutline } from "./bsl-outline.ts";

export interface NoteTarget {
	readonly key: string;
	readonly hash: string | null;
}

export function normalizeDocId(root: string, id: string): string {
	const [rawPath, name] = id.trim().split("#");
	const unified = rawPath.replace(/\\/g, "/");
	const relative = path.isAbsolute(unified) ? path.relative(root, unified).replace(/\\/g, "/") : unified;
	const clean = relative.replace(/^\.\//, "");
	return name ? `${clean}#${name.trim()}` : clean;
}

export async function resolveNoteTarget(root: string, key: string): Promise<NoteTarget | undefined> {
	// Находит символ в текущем файле модуля, чтобы заметка не считалась устаревшей после коммита этого кода.
	const [modulePath, name] = key.split("#");
	const content = await fs.readFile(path.join(root, modulePath), "utf8").catch(() => undefined);
	if (content === undefined) {
		return undefined;
	}
	const outline = buildModuleOutline(content);
	if (!name) {
		return { key: modulePath, hash: outline.hash };
	}
	const symbol = outline.symbols.find((item) => item.name.toLowerCase() === name.toLowerCase());
	return symbol ? { key: `${modulePath}#${symbol.name}`, hash: symbol.hash } : undefined;
}
