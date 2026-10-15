export type GitStatus = "A" | "M" | "D" | "R" | "C" | "U";

export interface GitFileChange {
	readonly path: string;
	readonly status: GitStatus;
}

export interface GitBlameLine {
	readonly commitHash: string;
	readonly author: string;
	readonly date: string;
	readonly line: number;
	readonly content: string;
	readonly summary: string;
}

export interface GitCommitInfo {
	readonly commitHash: string;
	readonly author: string;
	readonly date: string;
	readonly message: string;
	readonly taskRefs: readonly string[];
}

export interface GitBlameContextResult {
	readonly filePath: string;
	readonly target: string;
	readonly commits: readonly GitCommitInfo[];
	readonly blameLines: readonly GitBlameLine[];
	readonly summary: string;
}

export interface MethodDocUpdate {
	readonly methodName: string;
	readonly methodType: "procedure" | "function";
	readonly startLine: number;
	readonly existingDoc?: string;
	readonly generatedDoc: string;
	readonly hasDoc: boolean;
	readonly isExport: boolean;
}

export interface FileDocSummary {
	readonly filePath: string;
	readonly methods: readonly MethodDocUpdate[];
	readonly totalMethods: number;
	readonly documentedMethods: number;
	readonly patch?: string;
}

export interface DocGenResult {
	readonly targetRef: string;
	readonly files: readonly FileDocSummary[];
	readonly totalFiles: number;
	readonly totalMethods: number;
	readonly updatedMethods: number;
	readonly summary: string;
}
