export type AgentMode = "find" | "explain" | "write" | "plan";

export interface ModeConfig {
	readonly name: AgentMode;
	readonly title: string;
	readonly description: string;
	readonly allowedTools: readonly string[];
	readonly isReadOnly: boolean;
	readonly systemPromptSuffix: string;
}

export interface LspPosition {
	readonly line: number;
	readonly character: number;
}

export interface LspRange {
	readonly start: LspPosition;
	readonly end: LspPosition;
}

export type LspDiagnosticSeverity = 1 | 2 | 3 | 4; // 1: Error, 2: Warning, 3: Information, 4: Hint

export interface LspDiagnostic {
	readonly range: LspRange;
	readonly severity?: LspDiagnosticSeverity;
	readonly code?: string | number;
	readonly source?: string;
	readonly message: string;
}

export interface LspCallHierarchyItem {
	readonly name: string;
	readonly kind: number;
	readonly detail?: string;
	readonly uri: string;
	readonly range: LspRange;
	readonly selectionRange: LspRange;
}

export interface IncomingCallItem {
	readonly from: LspCallHierarchyItem;
	readonly fromRanges: readonly LspRange[];
}

export interface OutgoingCallItem {
	readonly to: LspCallHierarchyItem;
	readonly fromRanges: readonly LspRange[];
}

export interface BslParameter {
	readonly name: string;
	readonly defaultValue?: string;
	readonly byValue: boolean; // Знач
}

export type BslSymbolType = "procedure" | "function" | "variable";

export interface BslQueryInfo {
	readonly queryText: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly tables: readonly string[];
}

export interface BslAstSymbol {
	readonly name: string;
	readonly type: BslSymbolType;
	readonly isExport: boolean;
	readonly directive?: string; // &НаСервере, &НаКлиенте, etc.
	readonly startLine: number;
	readonly endLine: number;
	readonly parameters: readonly BslParameter[];
	readonly calls: readonly string[];
	readonly queries: readonly BslQueryInfo[];
	readonly bslDoc?: string;
}

export interface BslCallHierarchyResult {
	readonly symbol: string;
	readonly filePath: string;
	readonly incomingCalls: readonly {
		readonly caller: string;
		readonly filePath: string;
		readonly line: number;
	}[];
	readonly outgoingCalls: readonly {
		readonly callee: string;
		readonly filePath: string;
		readonly line: number;
	}[];
}

export interface BslImpactReference {
	readonly filePath: string;
	readonly line: number;
	readonly snippet: string;
	readonly contextType: "posting" | "module" | "query" | "register" | "other";
}

export interface BslImpactReport {
	readonly target: string;
	readonly directReferencesCount: number;
	readonly references: readonly BslImpactReference[];
	readonly affectedRegisters: readonly string[];
	readonly affectsPosting: boolean;
	readonly summary: string;
}

export type ViolationSeverity = "error" | "warning" | "info";

export interface BslRuleViolation {
	readonly ruleId: string;
	readonly ruleName: string;
	readonly message: string;
	readonly filePath: string;
	readonly line: number;
	readonly column: number;
	readonly endLine?: number;
	readonly endColumn?: number;
	readonly severity: ViolationSeverity;
	readonly canAutoFix: boolean;
	readonly suggestedFix?: string;
}

export interface BslPatch {
	readonly filePath: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly originalText: string;
	readonly replacementText: string;
	readonly description: string;
}

export interface StandardFixResult {
	readonly filePath: string;
	readonly totalViolations: number;
	readonly appliedFixes: number;
	readonly remainingViolations: readonly BslRuleViolation[];
	readonly diff?: string;
}

export type SubagentRole = "1c-architect" | "1c-coder" | "1c-tester" | "1c-reviewer";

export interface SubagentRoleConfig {
	readonly role: SubagentRole;
	readonly title: string;
	readonly description: string;
	readonly allowedTools: readonly string[];
	readonly systemPrompt: string;
}

export interface SubagentRunOptions {
	readonly role: SubagentRole;
	readonly task: string;
	readonly contextFiles?: readonly string[];
}

export interface SubagentRunResult {
	readonly role: SubagentRole;
	readonly task: string;
	readonly output: string;
	readonly warnings?: readonly string[];
}

export type PermissionLevel = "strict" | "auto-approve" | "yolo";

export interface PermissionCheckResult {
	readonly allowed: boolean;
	readonly requiresUserConfirmation: boolean;
	readonly reason?: string;
}

export type {
	DoctorItem,
	DoctorReport,
	DoctorRunResult,
	DoctorStatus,
} from "./doctor/types.ts";
export type { ToolchainPaths } from "./toolchain/resolver.ts";
export type {
	VanessaAction,
	VanessaCommandExecutor,
	VanessaToolOptions,
	VanessaToolResult,
} from "./vanessa/types.ts";
