import type { LspCallHierarchyItem, LspDiagnostic, LspPosition } from "../types.ts";

export interface JsonRpcRequest {
	readonly jsonrpc: "2.0";
	readonly id: number | string;
	readonly method: string;
	readonly params?: unknown;
}

export interface JsonRpcResponse {
	readonly jsonrpc: "2.0";
	readonly id: number | string;
	readonly result?: unknown;
	readonly error?: {
		readonly code: number;
		readonly message: string;
		readonly data?: unknown;
	};
}

export interface JsonRpcNotification {
	readonly jsonrpc: "2.0";
	readonly method: string;
	readonly params?: unknown;
}

export interface PublishDiagnosticsParams {
	readonly uri: string;
	readonly version?: number;
	readonly diagnostics: readonly LspDiagnostic[];
}

export interface TextDocumentItem {
	readonly uri: string;
	readonly languageId: string;
	readonly version: number;
	readonly text: string;
}

export interface DidOpenTextDocumentParams {
	readonly textDocument: TextDocumentItem;
}

export interface TextDocumentContentChangeEvent {
	readonly text: string;
}

export interface DidChangeTextDocumentParams {
	readonly textDocument: {
		readonly uri: string;
		readonly version: number;
	};
	readonly contentChanges: readonly TextDocumentContentChangeEvent[];
}

export interface CallHierarchyPrepareParams {
	readonly textDocument: {
		readonly uri: string;
	};
	readonly position: LspPosition;
}

export interface CallHierarchyIncomingCallsParams {
	readonly item: LspCallHierarchyItem;
}

export interface CallHierarchyOutgoingCallsParams {
	readonly item: LspCallHierarchyItem;
}
