// Чтение страниц документации, членов модуля, списков устаревших записей и счетчиков.
import type { SqliteDatabase, SqliteRow, SqliteValue } from "../storage/sqlite.ts";
import { parseCases } from "./docs-fts.ts";
import { folderLabel, moduleFileLabel } from "./metadata-labels.ts";
import type { DocKind, DocMember, DocNote, DocOutdatedItem, DocPage, DocParameter, DocSymbolKind } from "./types.ts";

export const STALE_SQL = "(n.source_hash IS NOT NULL AND n.source_hash <> e.hash)";
export const NOTES_JOIN = "LEFT JOIN notes n ON n.project_id = e.project_id AND n.doc_key = e.doc_key";

export interface DocsCounts {
	readonly modules: number;
	readonly symbols: number;
	readonly documented: number;
	readonly stale: number;
	readonly outdated: number;
}

const OUTDATED_SQL = `((n.doc_key IS NULL AND e.changed_in IS NOT NULL) OR ${STALE_SQL})`;

function text(value: SqliteValue | undefined): string | undefined {
	return value === null || value === undefined ? undefined : String(value);
}

function jsonArray<T>(value: SqliteValue | undefined): T[] {
	try {
		const parsed: unknown = JSON.parse(String(value ?? "[]"));
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
}

function noteFrom(row: SqliteRow): DocNote | undefined {
	if (row.note_summary === null || row.note_summary === undefined) {
		return undefined;
	}
	return {
		summary: String(row.note_summary),
		details: String(row.note_details ?? ""),
		cases: parseCases(row.note_cases),
		author: row.note_author === "user" ? "user" : "agent",
		updatedAt: String(row.note_updated_at ?? ""),
		stale: Number(row.stale) === 1,
	};
}

function breadcrumbs(path: string, name?: string): string[] {
	const segments = path.split("/").filter((segment) => segment !== "src");
	const file = segments.pop() ?? path;
	return [...segments.map(folderLabel), moduleFileLabel(file), ...(name ? [name] : [])];
}

export class DocsReader {
	// Читает данные документации для страниц, инструментов агента и плагина.
	private readonly db: SqliteDatabase;

	constructor(db: SqliteDatabase) {
		this.db = db;
	}

	public resolveKey(projectId: number, key: string): string | undefined {
		const exact = this.db
			.prepare("SELECT doc_key FROM entries WHERE project_id = ? AND doc_key = ?")
			.get(projectId, key);
		if (exact) {
			return String(exact.doc_key);
		}
		const [modulePath, name] = key.split("#");
		const row = name
			? this.db
					.prepare("SELECT doc_key FROM entries WHERE project_id = ? AND module_key = ? AND name_lower = ?")
					.get(projectId, modulePath, name.toLowerCase())
			: undefined;
		return row ? String(row.doc_key) : undefined;
	}

	public entryHash(projectId: number, key: string): string | undefined {
		return text(
			this.db.prepare("SELECT hash FROM entries WHERE project_id = ? AND doc_key = ?").get(projectId, key)?.hash,
		);
	}

	public page(projectId: number, key: string): DocPage | undefined {
		const row = this.db
			.prepare(
				`SELECT e.*, m.title AS module_title, p.revision, n.summary AS note_summary, n.details AS note_details,
				n.cases AS note_cases, n.author AS note_author, n.updated_at AS note_updated_at, ${STALE_SQL} AS stale
				FROM entries e JOIN projects p ON p.id = e.project_id
				LEFT JOIN entries m ON m.project_id = e.project_id AND m.doc_key = e.module_key ${NOTES_JOIN}
				WHERE e.project_id = ? AND e.doc_key = ?`,
			)
			.get(projectId, key);
		if (!row) {
			return undefined;
		}
		const kind = String(row.kind) as DocKind;
		const path = String(row.module_key);
		const isModule = kind === "module";
		return {
			id: key,
			kind,
			title: String(row.title),
			path,
			breadcrumbs: breadcrumbs(path, isModule ? undefined : String(row.name)),
			module: isModule ? undefined : { id: path, title: String(row.module_title ?? path) },
			signature: text(row.signature),
			isExport: isModule ? undefined : Number(row.is_export) === 1,
			directive: text(row.directive),
			region: text(row.region),
			line: Number(row.line),
			endLine: Number(row.end_line),
			parameters: jsonArray<DocParameter>(row.params),
			comment: text(row.comment),
			calls: jsonArray<string>(row.calls),
			note: noteFrom(row),
			members: isModule ? this.members(projectId, path) : [],
			revision: String(row.revision ?? ""),
		};
	}

	public members(projectId: number, path: string): DocMember[] {
		return this.db
			.prepare(
				`SELECT e.doc_key, e.kind, e.name, e.is_export, e.line, n.summary, n.doc_key AS noted, ${STALE_SQL} AS stale
				FROM entries e ${NOTES_JOIN}
				WHERE e.project_id = ? AND e.module_key = ? AND e.kind <> 'module' ORDER BY e.line`,
			)
			.all(projectId, path)
			.map((row) => ({
				id: String(row.doc_key),
				kind: String(row.kind) as DocSymbolKind,
				name: String(row.name),
				isExport: Number(row.is_export) === 1,
				line: Number(row.line),
				summary: text(row.summary),
				documented: row.noted !== null,
				stale: Number(row.stale) === 1,
			}));
	}

	public outdated(projectId: number, limit: number): DocOutdatedItem[] {
		return this.db
			.prepare(
				`SELECT e.doc_key, e.kind, e.title, e.module_key, m.title AS module_title, n.doc_key AS noted,
				e.change_type, ${STALE_SQL} AS stale
				FROM entries e ${NOTES_JOIN}
				LEFT JOIN entries m ON m.project_id = e.project_id AND m.doc_key = e.module_key
				WHERE e.project_id = ? AND ${OUTDATED_SQL}
				ORDER BY e.changed_at DESC, e.module_key, e.line LIMIT ?`,
			)
			.all(projectId, limit)
			.map((row) => ({
				id: String(row.doc_key),
				kind: String(row.kind) as DocKind,
				title: String(row.title),
				moduleTitle: String(row.module_title ?? row.module_key),
				path: String(row.module_key),
				reason: Number(row.stale) === 1 ? "stale" : row.change_type === "new" ? "new" : "changed",
			}));
	}

	public counts(projectId: number): DocsCounts {
		const row = this.db
			.prepare(
				`SELECT SUM(e.kind = 'module') AS modules, SUM(e.kind <> 'module') AS symbols,
				SUM(n.doc_key IS NOT NULL) AS documented, SUM(${STALE_SQL}) AS stale, SUM(${OUTDATED_SQL}) AS outdated
				FROM entries e ${NOTES_JOIN} WHERE e.project_id = ?`,
			)
			.get(projectId);
		return {
			modules: Number(row?.modules ?? 0),
			symbols: Number(row?.symbols ?? 0),
			documented: Number(row?.documented ?? 0),
			stale: Number(row?.stale ?? 0),
			outdated: Number(row?.outdated ?? 0),
		};
	}
}
