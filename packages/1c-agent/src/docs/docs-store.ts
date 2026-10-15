// Запись в базу документации: проекты, переиндексация модулей и заметки агента или пользователя.
import type { SqliteDatabase, SqliteRow } from "../storage/sqlite.ts";
import { noteText, parseCases, writeFtsRow } from "./docs-fts.ts";
import { moduleDrafts } from "./entry-drafts.ts";
import type { DocNoteInput, DocSourceType, ModuleOutline } from "./types.ts";

export interface ProjectRecord {
	readonly id: number;
	readonly source: DocSourceType;
	readonly revision: string | null;
	readonly syncedAt: string | null;
}

export interface ChangeStamp {
	readonly revision: string | null;
	readonly at: string;
}

const INSERT_ENTRY = `INSERT INTO entries (project_id, doc_key, module_key, kind, name, name_lower, title, signature,
	is_export, directive, region, params, comment, calls, line, end_line, hash, changed_in, changed_at, change_type)
	VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`;

function rowNoteText(row: SqliteRow | undefined): string {
	if (!row) {
		return "";
	}
	return noteText({ summary: String(row.summary), details: String(row.details), cases: parseCases(row.cases) });
}

export class DocsStore {
	// Пишет индекс модулей и заметки в базу документации.
	private readonly db: SqliteDatabase;

	constructor(db: SqliteDatabase) {
		this.db = db;
	}

	public transaction<T>(work: () => T): T {
		return this.db.transaction(work);
	}

	public ensureProject(root: string, source?: DocSourceType): ProjectRecord {
		this.db.prepare("INSERT OR IGNORE INTO projects (root, source) VALUES (?, ?)").run(root, source ?? "git");
		if (source) {
			this.db.prepare("UPDATE projects SET source = ? WHERE root = ?").run(source, root);
		}
		const row = this.db.prepare("SELECT id, source, revision, synced_at FROM projects WHERE root = ?").get(root);
		return {
			id: Number(row?.id),
			source: row?.source === "worktree" ? "worktree" : "git",
			revision: row?.revision == null ? null : String(row.revision),
			syncedAt: row?.synced_at == null ? null : String(row.synced_at),
		};
	}

	public listFiles(projectId: number): Map<string, string> {
		const rows = this.db.prepare("SELECT path, blob FROM files WHERE project_id = ?").all(projectId);
		return new Map(rows.map((row) => [String(row.path), String(row.blob)]));
	}

	public setRevision(projectId: number, revision: string, at: string): void {
		this.db.prepare("UPDATE projects SET revision = ?, synced_at = ? WHERE id = ?").run(revision, at, projectId);
	}

	public removeModule(projectId: number, path: string): void {
		this.db
			.prepare(
				"DELETE FROM entries_fts WHERE rowid IN (SELECT id FROM entries WHERE project_id = ? AND module_key = ?)",
			)
			.run(projectId, path);
		this.db.prepare("DELETE FROM entries WHERE project_id = ? AND module_key = ?").run(projectId, path);
		this.db.prepare("DELETE FROM files WHERE project_id = ? AND path = ?").run(projectId, path);
	}

	public replaceModule(
		projectId: number,
		path: string,
		blob: string,
		outline: ModuleOutline,
		stamp: ChangeStamp,
	): void {
		const previous = new Map(
			this.db
				.prepare(
					"SELECT doc_key, hash, changed_in, changed_at, change_type FROM entries WHERE project_id = ? AND module_key = ?",
				)
				.all(projectId, path)
				.map((row) => [String(row.doc_key), row]),
		);
		this.removeModule(projectId, path);
		for (const draft of moduleDrafts(path, outline)) {
			const before = previous.get(draft.key);
			const unchanged = before !== undefined && before.hash === draft.hash;
			const tracked = stamp.revision !== null;
			const changedIn = unchanged ? (before.changed_in ?? null) : stamp.revision;
			const changedAt = unchanged ? (before.changed_at ?? null) : tracked ? stamp.at : null;
			const changeType = unchanged ? (before.change_type ?? null) : !tracked ? null : before ? "changed" : "new";
			const inserted = this.db
				.prepare(INSERT_ENTRY)
				.get(
					projectId,
					draft.key,
					path,
					draft.kind,
					draft.name,
					draft.name.toLowerCase(),
					draft.title,
					draft.signature,
					draft.isExport ? 1 : 0,
					draft.directive,
					draft.region,
					draft.params,
					draft.comment,
					draft.calls,
					draft.line,
					draft.endLine,
					draft.hash,
					changedIn,
					changedAt,
					changeType,
				);
			const note = this.db
				.prepare("SELECT summary, details, cases FROM notes WHERE project_id = ? AND doc_key = ?")
				.get(projectId, draft.key);
			writeFtsRow(this.db, Number(inserted?.id), draft.title, draft.comment ?? "", rowNoteText(note));
		}
		this.db
			.prepare("INSERT OR REPLACE INTO files (project_id, path, blob) VALUES (?, ?, ?)")
			.run(projectId, path, blob);
	}

	public saveNote(projectId: number, key: string, input: DocNoteInput, sourceHash: string | null, at: string): void {
		this.db
			.prepare(
				`INSERT OR REPLACE INTO notes (project_id, doc_key, summary, details, cases, author, source_hash, updated_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.run(
				projectId,
				key,
				input.summary.trim(),
				(input.details ?? "").trim(),
				JSON.stringify(input.cases ?? []),
				input.author,
				sourceHash,
				at,
			);
		this.refreshEntryFts(projectId, key);
	}

	public removeNote(projectId: number, key: string): void {
		this.db.prepare("DELETE FROM notes WHERE project_id = ? AND doc_key = ?").run(projectId, key);
		this.refreshEntryFts(projectId, key);
	}

	private refreshEntryFts(projectId: number, key: string): void {
		const entry = this.db
			.prepare("SELECT id, title, comment FROM entries WHERE project_id = ? AND doc_key = ?")
			.get(projectId, key);
		if (!entry) {
			return;
		}
		const note = this.db
			.prepare("SELECT summary, details, cases FROM notes WHERE project_id = ? AND doc_key = ?")
			.get(projectId, key);
		writeFtsRow(this.db, Number(entry.id), String(entry.title), String(entry.comment ?? ""), rowNoteText(note));
	}
}
