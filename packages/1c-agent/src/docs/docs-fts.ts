// Обслуживание полнотекстового индекса документации: текст записи складывается из комментария кода и заметки.
import type { SqliteDatabase } from "../storage/sqlite.ts";
import type { DocCase } from "./types.ts";

export interface NoteTextParts {
	readonly summary: string;
	readonly details: string;
	readonly cases: readonly DocCase[];
}

export function noteText(note: NoteTextParts | undefined): string {
	if (!note) {
		return "";
	}
	const cases = note.cases.map((item) => `${item.title}\n${item.text}`);
	return [note.summary, note.details, ...cases].filter((part) => part.length > 0).join("\n");
}

export function parseCases(raw: unknown): DocCase[] {
	if (typeof raw !== "string") {
		return [];
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed)
			? parsed
					.filter((item): item is DocCase => typeof item?.title === "string" && typeof item?.text === "string")
					.map((item) => ({ title: item.title, text: item.text }))
			: [];
	} catch {
		return [];
	}
}

export function writeFtsRow(db: SqliteDatabase, entryId: number, title: string, comment: string, note: string): void {
	// Перезаписывает строку полнотекстового индекса для записи документации.
	db.prepare("DELETE FROM entries_fts WHERE rowid = ?").run(entryId);
	db.prepare("INSERT INTO entries_fts (rowid, title, body) VALUES (?, ?, ?)").run(
		entryId,
		title,
		[comment, note].filter((part) => part.length > 0).join("\n"),
	);
}
