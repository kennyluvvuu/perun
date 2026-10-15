// Инкрементальная синхронизация документации с источником: переиндексируются только новые, измененные и удаленные модули.
import { setImmediate as nextTick } from "node:timers/promises";
import { buildModuleOutline } from "./bsl-outline.ts";
import type { DocsSource, SourceFile } from "./docs-source.ts";
import type { DocsStore, ProjectRecord } from "./docs-store.ts";
import type { DocsSyncReport } from "./types.ts";

const BATCH_SIZE = 200;

export type SyncProgressListener = (done: number, total: number) => void;

export async function syncDocs(
	store: DocsStore,
	source: DocsSource,
	project: ProjectRecord,
	onProgress?: SyncProgressListener,
): Promise<DocsSyncReport> {
	// Сверяет версии файлов источника с базой и переиндексирует только расхождения.
	const startedAt = Date.now();
	const revision = await source.revision();
	if (project.revision === revision) {
		return { revision, added: 0, changed: 0, removed: 0, upToDate: true, durationMs: Date.now() - startedAt };
	}
	const current = await source.list();
	const known = store.listFiles(project.id);
	const removed = [...known.keys()].filter((filePath) => !current.has(filePath));
	const pending: SourceFile[] = [...current]
		.filter(([filePath, blob]) => known.get(filePath) !== blob)
		.map(([filePath, blob]) => ({ path: filePath, blob }));
	const added = pending.filter((file) => !known.has(file.path)).length;
	const stamp = { revision: project.revision === null ? null : revision, at: new Date().toISOString() };

	store.transaction(() => {
		for (const filePath of removed) {
			store.removeModule(project.id, filePath);
		}
	});
	onProgress?.(0, pending.length);
	for (let offset = 0; offset < pending.length; offset += BATCH_SIZE) {
		const batch = pending.slice(offset, offset + BATCH_SIZE);
		const contents = await source.read(batch);
		store.transaction(() => {
			for (const file of batch) {
				const content = contents.get(file.path);
				if (content !== undefined) {
					store.replaceModule(project.id, file.path, file.blob, buildModuleOutline(content), stamp);
				}
			}
		});
		onProgress?.(Math.min(offset + batch.length, pending.length), pending.length);
		await nextTick();
	}
	store.setRevision(project.id, revision, new Date().toISOString());
	return {
		revision,
		added,
		changed: pending.length - added,
		removed: removed.length,
		upToDate: false,
		durationMs: Date.now() - startedAt,
	};
}
