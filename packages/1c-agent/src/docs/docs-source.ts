// Контракт источника исходников для документации и выбор между git HEAD и рабочим каталогом.
import { createGitSource, readGitRevision } from "./source-git.ts";
import { createWorktreeSource } from "./source-worktree.ts";
import type { DocSourceType } from "./types.ts";

export interface SourceFile {
	readonly path: string;
	readonly blob: string;
}

export interface DocsSource {
	readonly type: DocSourceType;
	readonly root: string;
	revision(): Promise<string>;
	list(): Promise<Map<string, string>>;
	read(items: readonly SourceFile[]): Promise<Map<string, string>>;
}

export async function resolveDocsSource(root: string): Promise<DocsSource> {
	// Источник истины — последний коммит локального git; без git — файлы рабочего каталога.
	return (await readGitRevision(root)) ? createGitSource(root) : createWorktreeSource(root);
}
