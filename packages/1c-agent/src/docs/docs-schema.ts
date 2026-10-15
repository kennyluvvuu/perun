// Схема SQLite-базы документации: проекты, файлы, записи (модули и символы), заметки и полнотекстовый индекс.
import * as os from "node:os";
import * as path from "node:path";
import type { SqliteDatabase } from "../storage/sqlite.ts";

const SCHEMA = `
	CREATE TABLE IF NOT EXISTS projects (
		id INTEGER PRIMARY KEY,
		root TEXT NOT NULL UNIQUE,
		source TEXT NOT NULL,
		revision TEXT,
		synced_at TEXT
	);
	CREATE TABLE IF NOT EXISTS files (
		project_id INTEGER NOT NULL,
		path TEXT NOT NULL,
		blob TEXT NOT NULL,
		PRIMARY KEY (project_id, path)
	);
	CREATE TABLE IF NOT EXISTS entries (
		id INTEGER PRIMARY KEY,
		project_id INTEGER NOT NULL,
		doc_key TEXT NOT NULL,
		module_key TEXT NOT NULL,
		kind TEXT NOT NULL,
		name TEXT NOT NULL,
		name_lower TEXT NOT NULL,
		title TEXT NOT NULL,
		signature TEXT,
		is_export INTEGER NOT NULL DEFAULT 0,
		directive TEXT,
		region TEXT,
		params TEXT NOT NULL DEFAULT '[]',
		comment TEXT,
		calls TEXT NOT NULL DEFAULT '[]',
		line INTEGER NOT NULL,
		end_line INTEGER NOT NULL,
		hash TEXT NOT NULL,
		changed_in TEXT,
		changed_at TEXT,
		change_type TEXT,
		UNIQUE (project_id, doc_key)
	);
	CREATE INDEX IF NOT EXISTS entries_module ON entries (project_id, module_key);
	CREATE INDEX IF NOT EXISTS entries_kind ON entries (project_id, kind);
	CREATE INDEX IF NOT EXISTS entries_name ON entries (project_id, name_lower);
	CREATE TABLE IF NOT EXISTS notes (
		project_id INTEGER NOT NULL,
		doc_key TEXT NOT NULL,
		summary TEXT NOT NULL,
		details TEXT NOT NULL DEFAULT '',
		cases TEXT NOT NULL DEFAULT '[]',
		author TEXT NOT NULL,
		source_hash TEXT,
		updated_at TEXT NOT NULL,
		PRIMARY KEY (project_id, doc_key)
	);
	CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5 (
		title,
		body,
		tokenize = 'unicode61 remove_diacritics 2'
	);
`;

export function getDocsDbPath(): string {
	const agentDir = process.env.PERUN_CODING_AGENT_DIR || path.join(os.homedir(), ".perun", "agent");
	return process.env.PERUN_DOCS_DB || path.join(agentDir, "docs.db");
}

export function applyDocsSchema(db: SqliteDatabase): void {
	// Включает WAL для общего доступа нескольких процессов ПерУН и создает таблицы.
	db.exec("PRAGMA journal_mode = WAL");
	db.exec("PRAGMA busy_timeout = 5000");
	db.exec(SCHEMA);
}
