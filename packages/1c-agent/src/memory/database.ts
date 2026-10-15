import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { FeedbackRecord, LessonRecord } from "./types.ts";

export function getMemoryDbPath(): string {
	const agentDir = process.env.PERUN_CODING_AGENT_DIR || path.join(os.homedir(), ".perun", "agent");
	return path.join(agentDir, "memory.db");
}

export class MemoryStore {
	private db: DatabaseSync;
	private dbPath: string;

	constructor(customPath?: string) {
		this.dbPath = customPath || getMemoryDbPath();
		try {
			const dir = path.dirname(this.dbPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			this.db = new DatabaseSync(this.dbPath);
			this.initSchema();
		} catch {
			this.db = new DatabaseSync(":memory:");
			this.initSchema();
		}
	}

	private initSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS feedbacks (
				id TEXT PRIMARY KEY,
				kind TEXT,
				target TEXT,
				file TEXT,
				start_line INTEGER,
				end_line INTEGER,
				categories TEXT,
				comment TEXT,
				original_code TEXT,
				rewritten_code TEXT,
				model TEXT,
				cwd TEXT,
				created_at TEXT
			);
			CREATE TABLE IF NOT EXISTS lessons (
				id TEXT PRIMARY KEY,
				scope TEXT,
				key TEXT,
				lesson TEXT NOT NULL,
				cwd TEXT,
				confidence REAL,
				created_at TEXT
			);
		`);
	}

	public saveFeedback(feedback: Record<string, unknown>, defaultCwd?: string): FeedbackRecord {
		const id = String(feedback.id || crypto.randomUUID());
		const kind = feedback.kind ? String(feedback.kind) : null;
		const target = feedback.target ? String(feedback.target) : null;
		const file =
			feedback.file || feedback.filePath || feedback.path
				? String(feedback.file || feedback.filePath || feedback.path)
				: null;

		let start_line: number | null = null;
		if (typeof feedback.start_line === "number") {
			start_line = feedback.start_line;
		} else if (typeof feedback.startLine === "number") {
			start_line = feedback.startLine;
		}

		let end_line: number | null = null;
		if (typeof feedback.end_line === "number") {
			end_line = feedback.end_line;
		} else if (typeof feedback.endLine === "number") {
			end_line = feedback.endLine;
		}

		let categories: string | null = null;
		if (Array.isArray(feedback.categories)) {
			categories = JSON.stringify(feedback.categories);
		} else if (typeof feedback.categories === "string") {
			categories = feedback.categories;
		} else if (feedback.categories && typeof feedback.categories === "object") {
			categories = JSON.stringify(feedback.categories);
		}

		const comment =
			feedback.comment || feedback.message || feedback.text
				? String(feedback.comment || feedback.message || feedback.text)
				: null;
		const original_code =
			feedback.original_code || feedback.originalCode
				? String(feedback.original_code || feedback.originalCode)
				: null;
		const rewritten_code =
			feedback.rewritten_code || feedback.rewrittenCode
				? String(feedback.rewritten_code || feedback.rewrittenCode)
				: null;
		const model = feedback.model ? String(feedback.model) : null;
		const cwd = (feedback.cwd ? String(feedback.cwd) : defaultCwd) ?? null;
		const created_at = String(
			feedback.created_at || feedback.createdAt || feedback.timestamp || new Date().toISOString(),
		);

		const record: FeedbackRecord = {
			id,
			kind,
			target,
			file,
			start_line,
			end_line,
			categories,
			comment,
			original_code,
			rewritten_code,
			model,
			cwd,
			created_at,
		};

		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO feedbacks (
				id, kind, target, file, start_line, end_line, categories, comment, original_code, rewritten_code, model, cwd, created_at
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			record.id,
			record.kind ?? null,
			record.target ?? null,
			record.file ?? null,
			record.start_line ?? null,
			record.end_line ?? null,
			record.categories ?? null,
			record.comment ?? null,
			record.original_code ?? null,
			record.rewritten_code ?? null,
			record.model ?? null,
			record.cwd ?? null,
			record.created_at ?? null,
		);

		return record;
	}

	public saveLesson(lesson: Partial<LessonRecord> & { lesson: string }): LessonRecord {
		const record: LessonRecord = {
			id: lesson.id || crypto.randomUUID(),
			scope: lesson.scope ?? null,
			key: lesson.key ?? null,
			lesson: lesson.lesson,
			cwd: lesson.cwd ?? null,
			confidence: typeof lesson.confidence === "number" ? lesson.confidence : 1.0,
			created_at: lesson.created_at || new Date().toISOString(),
		};

		const stmt = this.db.prepare(`
			INSERT OR REPLACE INTO lessons (id, scope, key, lesson, cwd, confidence, created_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)
		`);

		stmt.run(
			record.id,
			record.scope ?? null,
			record.key ?? null,
			record.lesson,
			record.cwd ?? null,
			record.confidence ?? null,
			record.created_at ?? null,
		);

		return record;
	}

	public getRelevantLessons(cwd: string): LessonRecord[] {
		const target = cwd ? path.normalize(cwd) : "";
		const base = target ? path.basename(target) : "";
		const stmt = this.db.prepare(`
			SELECT id, scope, key, lesson, cwd, confidence, created_at
			FROM lessons
			WHERE cwd = ? OR cwd IS NULL OR cwd = '' OR scope = 'global'
			   OR (cwd LIKE '%' || ? || '%' AND ? != '')
			   OR (? != '' AND ? LIKE '%' || cwd || '%')
			ORDER BY created_at ASC
		`);

		const rows = stmt.all(target, base, base, target, target);
		return rows as unknown as LessonRecord[];
	}

	public getFeedbacks(limit = 100): FeedbackRecord[] {
		const stmt = this.db.prepare(`
			SELECT id, kind, target, file, start_line, end_line, categories, comment, original_code, rewritten_code, model, cwd, created_at
			FROM feedbacks
			ORDER BY created_at DESC
			LIMIT ?
		`);
		return stmt.all(limit) as unknown as FeedbackRecord[];
	}

	public close(): void {
		this.db.close();
	}
}

export function formatMemoryContext(lessons: LessonRecord[]): string {
	const items = lessons.map((l) => {
		const prefix = l.scope ? `[${l.scope}${l.key ? `:${l.key}` : ""}] ` : l.key ? `[${l.key}] ` : "";
		return `- ${prefix}${l.lesson}`;
	});
	return `[ПАМЯТЬ АГЕНТА: ПРАВИЛА И УРОКИ ПРОЕКТА]\n${items.join("\n")}`;
}
