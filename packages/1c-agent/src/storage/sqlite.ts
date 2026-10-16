// Единый доступ к SQLite в Node (node:sqlite) и в нативном бинарнике Bun (bun:sqlite).
import * as fs from "node:fs";
import * as path from "node:path";

export type SqliteValue = string | number | bigint | null | Uint8Array;
export type SqliteRow = Record<string, SqliteValue>;

export interface SqliteStatement {
	run(...params: SqliteValue[]): void;
	get(...params: SqliteValue[]): SqliteRow | undefined;
	all(...params: SqliteValue[]): SqliteRow[];
}

export interface SqliteDatabase {
	exec(sql: string): void;
	prepare(sql: string): SqliteStatement;
	transaction<T>(work: () => T): T;
	close(): void;
}

interface NativeStatement {
	run(...params: SqliteValue[]): unknown;
	get(...params: SqliteValue[]): unknown;
	all(...params: SqliteValue[]): unknown[];
}

interface NativeDatabase {
	exec(sql: string): unknown;
	prepare(sql: string): NativeStatement;
	close(): void;
}

type NativeDatabaseConstructor = new (location: string) => NativeDatabase;

function loadDriver(): NativeDatabaseConstructor {
	const isBun = typeof process.versions.bun === "string";
	const loaded: unknown = process.getBuiltinModule(isBun ? "bun:sqlite" : "node:sqlite");
	const driver = loaded as { Database?: NativeDatabaseConstructor; DatabaseSync?: NativeDatabaseConstructor };
	const driverClass = isBun ? driver?.Database : driver?.DatabaseSync;
	if (!driverClass) {
		throw new Error("SQLite недоступен в текущей среде выполнения");
	}
	return driverClass;
}

function wrapStatement(statement: NativeStatement): SqliteStatement {
	return {
		run: (...params) => {
			statement.run(...params);
		},
		get: (...params) => (statement.get(...params) as SqliteRow | null | undefined) ?? undefined,
		all: (...params) => statement.all(...params) as SqliteRow[],
	};
}

export function openSqlite(location: string): SqliteDatabase {
	// Открывает файл SQLite (создавая каталог), а при ошибке переходит на базу в памяти.
	const Driver = loadDriver();
	let native: NativeDatabase;
	try {
		if (location !== ":memory:") {
			fs.mkdirSync(path.dirname(location), { recursive: true });
		}
		native = new Driver(location);
	} catch {
		native = new Driver(":memory:");
	}
	const statements = new Map<string, SqliteStatement>();
	return {
		exec: (sql) => {
			native.exec(sql);
		},
		prepare: (sql) => {
			const cached = statements.get(sql);
			if (cached) {
				return cached;
			}
			const created = wrapStatement(native.prepare(sql));
			statements.set(sql, created);
			return created;
		},
		transaction: <T>(work: () => T): T => {
			native.exec("BEGIN IMMEDIATE");
			try {
				const result = work();
				native.exec("COMMIT");
				return result;
			} catch (error) {
				native.exec("ROLLBACK");
				throw error;
			}
		},
		close: () => {
			statements.clear();
			native.close();
		},
	};
}
