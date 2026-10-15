// Построение дерева сайдбара: раздел → каталоги метаданных → модули → символы, с ленивой подгрузкой по узлам.
import type { SqliteDatabase } from "../storage/sqlite.ts";
import { NOTES_JOIN, STALE_SQL } from "./docs-reader.ts";
import { folderLabel, isMetadataTypeFolder, isOwnModuleFile, moduleFileLabel } from "./metadata-labels.ts";
import type { DocKind, DocTreeNode } from "./types.ts";

interface ModuleStat {
	readonly path: string;
	readonly count: number;
	readonly documented: number;
	readonly stale: number;
}

interface FolderGroup {
	readonly rests: string[];
	count: number;
	documented: number;
	stale: number;
}

function moduleStats(db: SqliteDatabase, projectId: number, section: DocKind): ModuleStat[] {
	const sql =
		section === "module"
			? `SELECT e.doc_key AS path, (SELECT COUNT(*) FROM entries s WHERE s.project_id = e.project_id
				AND s.module_key = e.doc_key AND s.kind <> 'module') AS count,
				(n.doc_key IS NOT NULL) AS documented, ${STALE_SQL} AS stale
				FROM entries e ${NOTES_JOIN} WHERE e.project_id = ? AND e.kind = 'module'`
			: `SELECT e.module_key AS path, COUNT(*) AS count, SUM(n.doc_key IS NOT NULL) AS documented,
				SUM(${STALE_SQL}) AS stale FROM entries e ${NOTES_JOIN}
				WHERE e.project_id = ? AND e.kind = ? GROUP BY e.module_key`;
	const params = section === "module" ? [projectId] : [projectId, section];
	return db
		.prepare(sql)
		.all(...params)
		.map((row) => ({
			path: String(row.path),
			count: Number(row.count ?? 0),
			documented: Number(row.documented ?? 0),
			stale: Number(row.stale ?? 0),
		}));
}

function commonBase(paths: readonly string[]): string {
	if (paths.length === 0) {
		return "";
	}
	let base = paths[0].split("/").slice(0, -1);
	for (const current of paths.slice(1)) {
		const dirs = current.split("/").slice(0, -1);
		let index = 0;
		while (index < base.length && index < dirs.length && base[index] === dirs[index]) {
			index++;
		}
		base = base.slice(0, index);
	}
	const typeIndex = base.findIndex(isMetadataTypeFolder);
	return (typeIndex === -1 ? base : base.slice(0, typeIndex)).join("/");
}

function joinPath(prefix: string, segment: string): string {
	return prefix ? `${prefix}/${segment}` : segment;
}

function moduleNode(stat: ModuleStat, label: string, section: DocKind): DocTreeNode {
	const unitCount = section === "module" ? 1 : stat.count;
	return {
		id: stat.path,
		label,
		type: "module",
		kind: "module",
		docId: stat.path,
		count: stat.count,
		hasChildren: section !== "module" && stat.count > 0,
		documented: stat.documented >= unitCount,
		stale: stat.stale > 0,
	};
}

function folderChildren(stats: readonly ModuleStat[], folder: string, section: DocKind): DocTreeNode[] {
	const byPath = new Map(stats.map((stat) => [stat.path, stat]));
	const groups = new Map<string, FolderGroup>();
	const nodes: DocTreeNode[] = [];
	const prefix = folder ? `${folder}/` : "";
	for (const stat of stats) {
		if (!stat.path.startsWith(prefix)) {
			continue;
		}
		const rest = stat.path.slice(prefix.length);
		const slash = rest.indexOf("/");
		if (slash === -1) {
			nodes.push(moduleNode(stat, moduleFileLabel(rest), section));
			continue;
		}
		const name = rest.slice(0, slash);
		const group = groups.get(name) ?? { rests: [], count: 0, documented: 0, stale: 0 };
		group.rests.push(rest.slice(slash + 1));
		group.count += section === "module" ? 1 : stat.count;
		group.documented += section === "module" ? Math.min(stat.documented, 1) : stat.documented;
		group.stale += stat.stale;
		groups.set(name, group);
	}
	for (const [name, group] of groups) {
		const id = joinPath(folder, name);
		const single = group.rests.length === 1 && !group.rests[0].includes("/") ? group.rests[0] : undefined;
		const collapsed = single && isOwnModuleFile(single) ? byPath.get(`${id}/${single}`) : undefined;
		if (collapsed) {
			nodes.push(moduleNode(collapsed, name, section));
			continue;
		}
		nodes.push({
			id,
			label: folderLabel(name),
			type: "folder",
			count: group.count,
			hasChildren: true,
			documented: group.documented >= group.count,
			stale: group.stale > 0,
		});
	}
	return nodes.sort((left, right) =>
		left.type === right.type ? left.label.localeCompare(right.label, "ru") : left.type === "folder" ? -1 : 1,
	);
}

function symbolChildren(db: SqliteDatabase, projectId: number, modulePath: string, kind: DocKind): DocTreeNode[] {
	return db
		.prepare(
			`SELECT e.doc_key, e.name, e.is_export, n.doc_key AS noted, ${STALE_SQL} AS stale
			FROM entries e ${NOTES_JOIN} WHERE e.project_id = ? AND e.module_key = ? AND e.kind = ? ORDER BY e.name_lower`,
		)
		.all(projectId, modulePath, kind)
		.map((row) => ({
			id: String(row.doc_key),
			label: String(row.name),
			type: "symbol" as const,
			kind,
			docId: String(row.doc_key),
			count: 0,
			hasChildren: false,
			isExport: Number(row.is_export) === 1,
			documented: row.noted !== null,
			stale: Number(row.stale) === 1,
		}));
}

export function buildTreeLevel(db: SqliteDatabase, projectId: number, section: DocKind, node: string): DocTreeNode[] {
	// Возвращает прямых потомков узла дерева в разделе (пустой узел — корень раздела).
	const stats = moduleStats(db, projectId, section);
	if (node && section !== "module" && stats.some((stat) => stat.path === node)) {
		return symbolChildren(db, projectId, node, section);
	}
	const folder = node || commonBase(stats.map((stat) => stat.path));
	return folderChildren(stats, folder, section);
}
