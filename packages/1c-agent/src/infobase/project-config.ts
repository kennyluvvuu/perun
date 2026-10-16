// Выбор информационной базы проекта: реестр .v8-project.json (id, алиас, ветка Git, default) или build/ib по умолчанию.

import * as fs from "node:fs";
import * as path from "node:path";
import type { InfobaseTarget, ResolvedInfobase } from "./types.ts";

interface DatabaseEntry {
	readonly id: string;
	readonly name?: string;
	readonly type?: string;
	readonly path?: string;
	readonly server?: string;
	readonly ref?: string;
	readonly user?: string;
	readonly password?: string;
	readonly v8path?: string;
	readonly aliases: readonly string[];
	readonly branches: readonly string[];
}

interface ProjectRegistry {
	readonly v8path?: string;
	readonly v8args: readonly string[];
	readonly databases: readonly DatabaseEntry[];
	readonly default?: string;
}

const REGISTRY_FILE = ".v8-project.json";

function str(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}

function strings(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readRegistry(projectRoot: string): ProjectRegistry | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(fs.readFileSync(path.join(projectRoot, REGISTRY_FILE), "utf8"));
	} catch {
		return undefined;
	}
	if (typeof raw !== "object" || raw === null) {
		return undefined;
	}
	const record = raw as Record<string, unknown>;
	const databases = (Array.isArray(record.databases) ? record.databases : [])
		.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null)
		.map((item) => ({
			id: str(item.id) ?? "",
			name: str(item.name),
			type: str(item.type),
			path: str(item.path),
			server: str(item.server),
			ref: str(item.ref),
			user: str(item.user),
			password: typeof item.password === "string" ? item.password : undefined,
			v8path: str(item.v8path),
			aliases: strings(item.aliases),
			branches: strings(item.branches),
		}))
		.filter((item) => item.id);
	return { v8path: str(record.v8path), v8args: strings(record.v8args), databases, default: str(record.default) };
}

function currentBranch(projectRoot: string): string | undefined {
	try {
		const head = fs.readFileSync(path.join(projectRoot, ".git", "HEAD"), "utf8").trim();
		return head.startsWith("ref: refs/heads/") ? head.slice("ref: refs/heads/".length) : undefined;
	} catch {
		return undefined;
	}
}

function matchesBranch(pattern: string, branch: string): boolean {
	const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
	return regex.test(branch);
}

function targetOf(entry: DatabaseEntry, projectRoot: string): InfobaseTarget | undefined {
	if (entry.server && entry.ref) {
		return { type: "server", server: entry.server, ref: entry.ref, user: entry.user, password: entry.password };
	}
	if (entry.path) {
		return { type: "file", path: path.resolve(projectRoot, entry.path), user: entry.user, password: entry.password };
	}
	return undefined;
}

function pick(
	registry: ProjectRegistry,
	projectRoot: string,
	requested?: string,
): { entry: DatabaseEntry; reason: string } | undefined {
	const key = requested?.toLowerCase();
	if (key) {
		const entry = registry.databases.find(
			(item) =>
				item.id.toLowerCase() === key ||
				item.aliases.some((alias) => alias.toLowerCase() === key) ||
				item.name?.toLowerCase() === key,
		);
		return entry ? { entry, reason: `по имени «${requested}»` } : undefined;
	}
	const branch = currentBranch(projectRoot);
	const byBranch = branch
		? registry.databases.find((item) => item.branches.some((pattern) => matchesBranch(pattern, branch)))
		: undefined;
	if (byBranch) {
		return { entry: byBranch, reason: `по ветке ${branch}` };
	}
	const fallback = registry.databases.find((item) => item.id === registry.default);
	return fallback ? { entry: fallback, reason: "default" } : undefined;
}

export function resolveInfobase(projectRoot: string, requested?: string): ResolvedInfobase | string {
	// Определяет базу для сборки и запуска; строка — описание ошибки выбора.
	const registry = readRegistry(projectRoot);
	if (registry) {
		const chosen = pick(registry, projectRoot, requested);
		if (!chosen && requested) {
			return `база «${requested}» не найдена в ${REGISTRY_FILE}; доступны: ${registry.databases.map((item) => item.id).join(", ")}`;
		}
		const target = chosen ? targetOf(chosen.entry, projectRoot) : undefined;
		if (chosen && target) {
			return {
				id: chosen.entry.id,
				source: `${REGISTRY_FILE} (${chosen.reason})`,
				target,
				v8path: chosen.entry.v8path ?? registry.v8path,
				extraArgs: registry.v8args,
			};
		}
	}
	if (requested) {
		return `база «${requested}» не найдена: нет ${REGISTRY_FILE} с таким id/алиасом`;
	}
	return {
		id: "build/ib",
		source: "по умолчанию",
		target: { type: "file", path: path.join(projectRoot, "build", "ib") },
		extraArgs: [],
	};
}

export function connectionString(target: InfobaseTarget): string {
	return target.type === "file" ? `/F${target.path}` : `/S${target.server}\\${target.ref}`;
}
