// Подготовка записей базы документации из структуры модуля BSL.
import { describeModule } from "./metadata-labels.ts";
import type { ModuleOutline } from "./types.ts";

export interface EntryDraft {
	readonly key: string;
	readonly kind: string;
	readonly name: string;
	readonly title: string;
	readonly signature: string | null;
	readonly isExport: boolean;
	readonly directive: string | null;
	readonly region: string | null;
	readonly params: string;
	readonly comment: string | null;
	readonly calls: string;
	readonly line: number;
	readonly endLine: number;
	readonly hash: string;
}

export function moduleDrafts(path: string, outline: ModuleOutline): EntryDraft[] {
	// Превращает структуру модуля в записи базы: сам модуль и его уникальные по имени символы.
	const title = describeModule(path);
	const drafts: EntryDraft[] = [
		{
			key: path,
			kind: "module",
			name: title,
			title,
			signature: null,
			isExport: false,
			directive: null,
			region: null,
			params: "[]",
			comment: outline.comment ?? null,
			calls: "[]",
			line: 1,
			endLine: outline.lineCount,
			hash: outline.hash,
		},
	];
	const seen = new Set<string>();
	for (const symbol of outline.symbols) {
		const lower = symbol.name.toLowerCase();
		if (seen.has(lower)) {
			continue;
		}
		seen.add(lower);
		drafts.push({
			key: `${path}#${symbol.name}`,
			kind: symbol.kind,
			name: symbol.name,
			title: symbol.name,
			signature: symbol.signature,
			isExport: symbol.isExport,
			directive: symbol.directive ?? null,
			region: symbol.region ?? null,
			params: JSON.stringify(symbol.parameters),
			comment: symbol.comment ?? null,
			calls: JSON.stringify(symbol.calls),
			line: symbol.line,
			endLine: symbol.endLine,
			hash: symbol.hash,
		});
	}
	return drafts;
}
