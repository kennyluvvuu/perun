// Поиск по документации: сначала совпадения имен (подстрока без учета регистра), затем полнотекстовый поиск.
import type { SqliteDatabase, SqliteRow, SqliteValue } from "../storage/sqlite.ts";
import { NOTES_JOIN } from "./docs-reader.ts";
import type { DocKind, DocSearchHit } from "./types.ts";

const HIT_COLUMNS = `e.doc_key, e.kind, e.title, e.module_key, e.signature, e.comment, n.summary,
	n.doc_key AS noted, m.title AS module_title`;
const MODULE_JOIN = "LEFT JOIN entries m ON m.project_id = e.project_id AND m.doc_key = e.module_key";

function escapeLike(value: string): string {
	return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function ftsQuery(query: string): string {
	return query
		.split(/\s+/)
		.map((token) => token.replace(/["*^():]/g, ""))
		.filter((token) => token.length > 0)
		.map((token) => `"${token}"*`)
		.join(" ");
}

function toHit(row: SqliteRow, snippet?: SqliteValue): DocSearchHit {
	const fallback = row.summary ?? row.signature ?? row.comment ?? "";
	return {
		id: String(row.doc_key),
		kind: String(row.kind) as DocKind,
		title: String(row.title),
		moduleTitle: String(row.module_title ?? row.module_key),
		path: String(row.module_key),
		snippet: String(snippet || fallback)
			.replace(/\s+/g, " ")
			.slice(0, 240),
		documented: row.noted !== null,
	};
}

export function searchDocs(
	db: SqliteDatabase,
	projectId: number,
	query: string,
	kind: DocKind | undefined,
	limit: number,
): DocSearchHit[] {
	// Ищет записи документации по имени и тексту, возвращая не больше limit результатов.
	const needle = query.trim().toLowerCase();
	if (!needle) {
		return [];
	}
	const kindFilter = kind ? "AND e.kind = ?" : "";
	const kindParams = kind ? [kind] : [];
	const byName = db
		.prepare(
			`SELECT ${HIT_COLUMNS} FROM entries e ${NOTES_JOIN} ${MODULE_JOIN}
			WHERE e.project_id = ? ${kindFilter} AND e.name_lower LIKE ? ESCAPE '\\'
			ORDER BY (e.name_lower = ?) DESC, (e.name_lower LIKE ? ESCAPE '\\') DESC, e.is_export DESC,
			length(e.name), e.name_lower LIMIT ?`,
		)
		.all(projectId, ...kindParams, `%${escapeLike(needle)}%`, needle, `${escapeLike(needle)}%`, limit)
		.map((row) => toHit(row));
	const seen = new Set(byName.map((hit) => hit.id));
	const match = ftsQuery(query);
	if (byName.length >= limit || !match) {
		return byName;
	}
	let byText: DocSearchHit[] = [];
	try {
		byText = db
			.prepare(
				`SELECT ${HIT_COLUMNS}, snippet(entries_fts, 1, '«', '»', '…', 16) AS snip
				FROM entries_fts JOIN entries e ON e.id = entries_fts.rowid ${NOTES_JOIN} ${MODULE_JOIN}
				WHERE entries_fts MATCH ? AND e.project_id = ? ${kindFilter} ORDER BY bm25(entries_fts) LIMIT ?`,
			)
			.all(match, projectId, ...kindParams, limit * 2)
			.map((row) => toHit(row, row.snip))
			.filter((hit) => !seen.has(hit.id));
	} catch {
		byText = [];
	}
	return [...byName, ...byText].slice(0, limit);
}
