// Сервис единой документации проекта: ленивое открытие базы, фоновая синхронизация и операции чтения/записи.
import * as path from "node:path";
import { openSqlite, type SqliteDatabase } from "../storage/sqlite.ts";
import { DocsReader } from "./docs-reader.ts";
import { applyDocsSchema, getDocsDbPath } from "./docs-schema.ts";
import { searchDocs } from "./docs-search.ts";
import { type DocsSource, resolveDocsSource } from "./docs-source.ts";
import { DocsStore, type ProjectRecord } from "./docs-store.ts";
import { syncDocs } from "./docs-sync.ts";
import { buildTreeLevel } from "./docs-tree.ts";
import { normalizeDocId, resolveNoteTarget } from "./note-target.ts";
import type {
	DocCase,
	DocKind,
	DocOutdatedItem,
	DocPage,
	DocSearchHit,
	DocsStatus,
	DocsSyncReport,
	DocTreeNode,
} from "./types.ts";

export interface DocsServiceOptions {
	readonly root: string;
	readonly dbPath?: string;
	readonly checkIntervalMs?: number;
	readonly onStatus?: (text: string) => void;
}

export interface DocNoteFields {
	readonly summary: string;
	readonly details?: string;
	readonly cases?: readonly DocCase[];
}

interface OpenedDatabase {
	readonly db: SqliteDatabase;
	readonly store: DocsStore;
	readonly reader: DocsReader;
}

export class DocsService {
	// Единая точка доступа к документации для инструментов агента, RPC-методов плагина и команды /docs.
	private readonly options: DocsServiceOptions;
	private root: string;
	private opened: OpenedDatabase | undefined;
	private source: DocsSource | undefined;
	private running: Promise<DocsSyncReport> | undefined;
	private progress: { done: number; total: number } | null = null;
	private lastError: string | null = null;
	private lastCheck = 0;
	private lastStatus = "";

	constructor(options: DocsServiceOptions) {
		this.options = options;
		this.root = path.resolve(options.root);
	}

	public getRoot(): string {
		return this.root;
	}

	public setRoot(root: string): void {
		const resolved = path.resolve(root);
		if (resolved !== this.root) {
			this.root = resolved;
			this.source = undefined;
			this.lastCheck = 0;
		}
	}

	public refresh(): void {
		const interval = this.options.checkIntervalMs ?? 3000;
		if (this.running || Date.now() - this.lastCheck < interval) {
			return;
		}
		this.sync().catch(() => undefined);
	}

	public sync(): Promise<DocsSyncReport> {
		if (this.running) {
			return this.running;
		}
		this.lastCheck = Date.now();
		this.running = this.runSync().finally(() => {
			this.running = undefined;
			this.progress = null;
		});
		return this.running;
	}

	public status(): DocsStatus {
		const { reader } = this.database();
		const project = this.project();
		return {
			root: this.root,
			source: project.source,
			revision: project.revision,
			syncedAt: project.syncedAt,
			syncing: this.progress !== null,
			progress: this.progress,
			lastError: this.lastError,
			...reader.counts(project.id),
		};
	}

	public tree(section: DocKind, node: string): DocTreeNode[] {
		return buildTreeLevel(this.database().db, this.project().id, section, node);
	}

	public page(id: string): DocPage {
		const projectId = this.project().id;
		const key = this.database().reader.resolveKey(projectId, normalizeDocId(this.root, id));
		const page = key ? this.database().reader.page(projectId, key) : undefined;
		if (!page) {
			throw new Error(`Документация не найдена: ${id}`);
		}
		return page;
	}

	public search(query: string, kind: DocKind | undefined, limit: number): DocSearchHit[] {
		return searchDocs(this.database().db, this.project().id, query, kind, limit);
	}

	public outdated(limit: number): DocOutdatedItem[] {
		return this.database().reader.outdated(this.project().id, limit);
	}

	public async saveNote(id: string, fields: DocNoteFields, author: "agent" | "user"): Promise<DocPage | undefined> {
		if (!fields.summary.trim()) {
			throw new Error("Краткое описание (summary) не может быть пустым");
		}
		const { store, reader } = this.database();
		const projectId = this.project().id;
		const requested = normalizeDocId(this.root, id);
		const indexedKey = reader.resolveKey(projectId, requested);
		const target = await resolveNoteTarget(this.root, indexedKey ?? requested);
		const key = indexedKey ?? target?.key;
		if (!key) {
			throw new Error(`Не найден модуль или символ для документации: ${id}`);
		}
		const hash = target?.hash ?? reader.entryHash(projectId, key) ?? null;
		store.saveNote(projectId, key, { ...fields, author }, hash, new Date().toISOString());
		return reader.page(projectId, key);
	}

	public removeNote(id: string): void {
		const projectId = this.project().id;
		const key = normalizeDocId(this.root, id);
		this.database().store.removeNote(projectId, this.database().reader.resolveKey(projectId, key) ?? key);
	}

	public close(): void {
		this.opened?.db.close();
		this.opened = undefined;
	}

	private database(): OpenedDatabase {
		if (!this.opened) {
			const db = openSqlite(this.options.dbPath ?? getDocsDbPath());
			applyDocsSchema(db);
			this.opened = { db, store: new DocsStore(db), reader: new DocsReader(db) };
		}
		return this.opened;
	}

	private project(): ProjectRecord {
		return this.database().store.ensureProject(this.root, this.source?.type);
	}

	private async runSync(): Promise<DocsSyncReport> {
		try {
			this.source = this.source ?? (await resolveDocsSource(this.root));
			const { store } = this.database();
			const project = store.ensureProject(this.root, this.source.type);
			const report = await syncDocs(store, this.source, project, (done, total) => {
				this.progress = { done, total };
				this.emitStatus(`Документация: индексация ${done}/${total}`);
			});
			this.lastError = null;
			this.emitStatus(`Документация: ${report.revision.replace(/^worktree:/, "").slice(0, 8)}`);
			return report;
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : String(error);
			this.emitStatus("Документация: ошибка синхронизации");
			throw error;
		}
	}

	private emitStatus(text: string): void {
		if (text !== this.lastStatus) {
			this.lastStatus = text;
			this.options.onStatus?.(text);
		}
	}
}
