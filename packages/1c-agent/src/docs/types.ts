// Доменные типы единой документации 1С-проекта: разделы, страницы, дерево, поиск и синхронизация.

export type DocKind = "module" | "procedure" | "function" | "variable";
export type DocSymbolKind = Exclude<DocKind, "module">;
export type DocAuthor = "agent" | "user";
export type DocSourceType = "git" | "worktree";
export type DocOutdatedReason = "new" | "changed" | "stale";

export const DOC_KINDS: readonly DocKind[] = ["module", "procedure", "function", "variable"];

export interface DocParameter {
	readonly name: string;
	readonly byValue: boolean;
	readonly defaultValue?: string;
}

export interface OutlineSymbol {
	readonly name: string;
	readonly kind: DocSymbolKind;
	readonly isExport: boolean;
	readonly directive?: string;
	readonly region?: string;
	readonly signature: string;
	readonly parameters: readonly DocParameter[];
	readonly comment?: string;
	readonly calls: readonly string[];
	readonly line: number;
	readonly endLine: number;
	readonly hash: string;
}

export interface ModuleOutline {
	readonly comment?: string;
	readonly hash: string;
	readonly lineCount: number;
	readonly symbols: readonly OutlineSymbol[];
}

export interface DocCase {
	readonly title: string;
	readonly text: string;
}

export interface DocNoteInput {
	readonly summary: string;
	readonly details?: string;
	readonly cases?: readonly DocCase[];
	readonly author: DocAuthor;
}

export interface DocNote {
	readonly summary: string;
	readonly details: string;
	readonly cases: readonly DocCase[];
	readonly author: DocAuthor;
	readonly updatedAt: string;
	readonly stale: boolean;
}

export interface DocLink {
	readonly id: string;
	readonly title: string;
}

export interface DocMember {
	readonly id: string;
	readonly kind: DocSymbolKind;
	readonly name: string;
	readonly isExport: boolean;
	readonly line: number;
	readonly summary?: string;
	readonly documented: boolean;
	readonly stale: boolean;
}

export interface DocPage {
	readonly id: string;
	readonly kind: DocKind;
	readonly title: string;
	readonly path: string;
	readonly breadcrumbs: readonly string[];
	readonly module?: DocLink;
	readonly signature?: string;
	readonly isExport?: boolean;
	readonly directive?: string;
	readonly region?: string;
	readonly line: number;
	readonly endLine: number;
	readonly parameters: readonly DocParameter[];
	readonly comment?: string;
	readonly calls: readonly string[];
	readonly note?: DocNote;
	readonly members: readonly DocMember[];
	readonly revision: string;
}

export type DocTreeNodeType = "folder" | "module" | "symbol";

export interface DocTreeNode {
	readonly id: string;
	readonly label: string;
	readonly type: DocTreeNodeType;
	readonly kind?: DocKind;
	readonly docId?: string;
	readonly count: number;
	readonly hasChildren: boolean;
	readonly isExport?: boolean;
	readonly documented: boolean;
	readonly stale: boolean;
}

export interface DocSearchHit {
	readonly id: string;
	readonly kind: DocKind;
	readonly title: string;
	readonly moduleTitle: string;
	readonly path: string;
	readonly snippet: string;
	readonly documented: boolean;
}

export interface DocOutdatedItem {
	readonly id: string;
	readonly kind: DocKind;
	readonly title: string;
	readonly moduleTitle: string;
	readonly path: string;
	readonly reason: DocOutdatedReason;
}

export interface DocsSyncReport {
	readonly revision: string;
	readonly added: number;
	readonly changed: number;
	readonly removed: number;
	readonly upToDate: boolean;
	readonly durationMs: number;
}

export interface DocsStatus {
	readonly root: string;
	readonly source: DocSourceType;
	readonly revision: string | null;
	readonly syncedAt: string | null;
	readonly syncing: boolean;
	readonly progress: { readonly done: number; readonly total: number } | null;
	readonly lastError: string | null;
	readonly modules: number;
	readonly symbols: number;
	readonly documented: number;
	readonly stale: number;
	readonly outdated: number;
}
