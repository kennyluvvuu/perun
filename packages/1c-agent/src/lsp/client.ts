import { type ChildProcess, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveBslAnalyzerPath } from "../toolchain/resolver.ts";
import type { IncomingCallItem, LspCallHierarchyItem, LspDiagnostic, LspPosition, OutgoingCallItem } from "../types.ts";
import type {
	CallHierarchyIncomingCallsParams,
	CallHierarchyOutgoingCallsParams,
	CallHierarchyPrepareParams,
	DidChangeTextDocumentParams,
	DidOpenTextDocumentParams,
	JsonRpcNotification,
	JsonRpcRequest,
	PublishDiagnosticsParams,
} from "./types.ts";

export interface BslLspClientOptions {
	executablePath?: string;
	projectPath?: string;
	timeoutMs?: number;
}

export class BslLspClient {
	private executablePath?: string;
	private projectPath: string;
	private readonly defaultTimeoutMs: number;
	private process: ChildProcess | null = null;
	private startingPromise: Promise<boolean> | null = null;
	private nextRequestId = 1;
	private readonly pendingRequests = new Map<
		number | string,
		{
			resolve: (result: unknown) => void;
			reject: (err: Error) => void;
			timer: NodeJS.Timeout;
		}
	>();
	private readonly diagnosticsCache = new Map<string, readonly LspDiagnostic[]>();
	private readonly diagnosticWaiters = new Map<string, Array<(diagnostics: readonly LspDiagnostic[]) => void>>();
	private readonly documentVersions = new Map<string, number>();
	private buffer = Buffer.alloc(0);
	private isInitialized = false;

	constructor(options: BslLspClientOptions = {}) {
		this.executablePath = options.executablePath;
		this.projectPath = options.projectPath || process.cwd();
		this.defaultTimeoutMs = options.timeoutMs ?? 10000;
	}

	public getExecutablePath(): string | undefined {
		return this.executablePath;
	}

	public isRunning(): boolean {
		return this.process !== null && !this.process.killed;
	}

	public isReady(): boolean {
		return this.isRunning() && this.isInitialized;
	}

	public async start(projectPath?: string): Promise<boolean> {
		if (this.isRunning()) {
			return true;
		}
		if (this.startingPromise) {
			return this.startingPromise;
		}
		this.startingPromise = this.doStart(projectPath);
		try {
			return await this.startingPromise;
		} finally {
			this.startingPromise = null;
		}
	}

	private async doStart(projectPath?: string): Promise<boolean> {
		this.executablePath ??= resolveBslAnalyzerPath(this.executablePath);

		if (!this.executablePath) {
			return false;
		}

		if (projectPath) {
			this.projectPath = projectPath;
		}

		try {
			const child = spawn(this.executablePath, ["lsp"], {
				cwd: this.projectPath,
				stdio: ["pipe", "pipe", "pipe"],
			});

			this.process = child;

			child.stdout?.on("data", (chunk: Buffer) => {
				this.handleStdoutData(chunk);
			});

			child.stderr?.on("data", (_chunk: Buffer) => {
				// stderr output from lsp daemon (debug/trace)
			});

			child.on("error", (_err: Error) => {
				this.cleanup();
			});

			child.on("exit", () => {
				this.cleanup();
			});

			// Perform LSP initialization
			const initSuccess = await this.initializeServer();
			return initSuccess;
		} catch {
			this.cleanup();
			return false;
		}
	}

	public async stop(): Promise<void> {
		if (!this.process) return;

		try {
			if (this.isInitialized) {
				await this.sendRequest("shutdown", {}).catch(() => {});
				this.sendNotification("exit", {});
			}
		} finally {
			this.cleanup();
		}
	}

	private cleanup(): void {
		if (this.process && !this.process.killed) {
			this.process.kill();
		}
		this.process = null;
		this.isInitialized = false;
		for (const [, req] of this.pendingRequests) {
			clearTimeout(req.timer);
			req.reject(new Error("LSP process terminated"));
		}
		this.pendingRequests.clear();
	}

	public filePathToUri(filePath: string): string {
		const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(this.projectPath, filePath);
		return pathToFileURL(absolutePath).toString();
	}

	public uriToFilePath(uri: string): string {
		if (uri.startsWith("file://")) {
			try {
				return fileURLToPath(uri);
			} catch {
				return decodeURIComponent(new URL(uri).pathname);
			}
		}
		return uri;
	}

	public async openDocument(filePath: string, content?: string): Promise<void> {
		if (!this.isReady()) return;

		const uri = this.filePathToUri(filePath);
		let text = content;
		if (text === undefined) {
			try {
				text = await fs.promises.readFile(this.uriToFilePath(uri), "utf8");
			} catch {
				return;
			}
		}

		const version = 1;
		this.documentVersions.set(uri, version);

		const params: DidOpenTextDocumentParams = {
			textDocument: {
				uri,
				languageId: "bsl",
				version,
				text,
			},
		};

		this.sendNotification("textDocument/didOpen", params);
	}

	public async changeDocument(filePath: string, content: string): Promise<void> {
		if (!this.isReady()) return;

		const uri = this.filePathToUri(filePath);
		const currentVersion = (this.documentVersions.get(uri) ?? 0) + 1;
		this.documentVersions.set(uri, currentVersion);

		const params: DidChangeTextDocumentParams = {
			textDocument: {
				uri,
				version: currentVersion,
			},
			contentChanges: [{ text: content }],
		};

		this.sendNotification("textDocument/didChange", params);
	}

	public getDiagnostics(filePath: string): readonly LspDiagnostic[] {
		const uri = this.filePathToUri(filePath);
		return this.diagnosticsCache.get(uri) ?? [];
	}

	public async waitForDiagnostics(filePath: string, timeoutMs = 300): Promise<readonly LspDiagnostic[]> {
		const uri = this.filePathToUri(filePath);

		return new Promise<readonly LspDiagnostic[]>((resolve) => {
			let timer: NodeJS.Timeout | null = null;

			const onDiagnostics = (diagnostics: readonly LspDiagnostic[]) => {
				if (timer) clearTimeout(timer);
				resolve(diagnostics);
			};

			const waiters = this.diagnosticWaiters.get(uri) ?? [];
			waiters.push(onDiagnostics);
			this.diagnosticWaiters.set(uri, waiters);

			timer = setTimeout(() => {
				const currentWaiters = this.diagnosticWaiters.get(uri) ?? [];
				this.diagnosticWaiters.set(
					uri,
					currentWaiters.filter((w) => w !== onDiagnostics),
				);
				resolve(this.getDiagnostics(filePath));
			}, timeoutMs);
		});
	}

	public async prepareCallHierarchy(filePath: string, position: LspPosition): Promise<LspCallHierarchyItem[] | null> {
		if (!this.isReady()) return null;

		const uri = this.filePathToUri(filePath);
		const params: CallHierarchyPrepareParams = {
			textDocument: { uri },
			position,
		};

		try {
			const result = (await this.sendRequest("textDocument/prepareCallHierarchy", params)) as
				| LspCallHierarchyItem[]
				| null;
			return result;
		} catch {
			return null;
		}
	}

	public async incomingCalls(item: LspCallHierarchyItem): Promise<IncomingCallItem[]> {
		if (!this.isReady()) return [];

		const params: CallHierarchyIncomingCallsParams = { item };
		try {
			const result = (await this.sendRequest("callHierarchy/incomingCalls", params)) as IncomingCallItem[] | null;
			return result ?? [];
		} catch {
			return [];
		}
	}

	public async outgoingCalls(item: LspCallHierarchyItem): Promise<OutgoingCallItem[]> {
		if (!this.isReady()) return [];

		const params: CallHierarchyOutgoingCallsParams = { item };
		try {
			const result = (await this.sendRequest("callHierarchy/outgoingCalls", params)) as OutgoingCallItem[] | null;
			return result ?? [];
		} catch {
			return [];
		}
	}

	private async initializeServer(): Promise<boolean> {
		const rootUri = pathToFileURL(this.projectPath).toString();

		try {
			await this.sendRequest(
				"initialize",
				{
					processId: process.pid,
					rootUri,
					capabilities: {
						textDocument: {
							synchronization: {
								dynamicRegistration: false,
								willSave: false,
								willSaveWaitUntil: false,
								didSave: false,
							},
							publishDiagnostics: {
								relatedInformation: true,
							},
							callHierarchy: {
								dynamicRegistration: false,
							},
						},
					},
				},
				5000,
			);

			this.sendNotification("initialized", {});
			this.isInitialized = true;
			return true;
		} catch {
			return false;
		}
	}

	public sendRequest(method: string, params: unknown, timeoutMs = this.defaultTimeoutMs): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.process?.stdin) {
				reject(new Error("LSP server not running"));
				return;
			}

			const id = this.nextRequestId++;
			const request: JsonRpcRequest = {
				jsonrpc: "2.0",
				id,
				method,
				params,
			};

			const timer = setTimeout(() => {
				this.pendingRequests.delete(id);
				reject(new Error(`LSP request '${method}' timed out after ${timeoutMs}ms`));
			}, timeoutMs);

			this.pendingRequests.set(id, { resolve, reject, timer });
			this.writeMessage(JSON.stringify(request));
		});
	}

	public sendNotification(method: string, params: unknown): void {
		if (!this.process?.stdin) return;

		const notification: JsonRpcNotification = {
			jsonrpc: "2.0",
			method,
			params,
		};

		this.writeMessage(JSON.stringify(notification));
	}

	private writeMessage(json: string): void {
		if (!this.process?.stdin) return;
		const byteLength = Buffer.byteLength(json, "utf8");
		const header = `Content-Length: ${byteLength}\r\n\r\n`;
		this.process.stdin.write(header + json);
	}

	private handleStdoutData(chunk: Buffer): void {
		this.buffer = Buffer.concat([this.buffer, chunk]);

		while (true) {
			const headerSeparatorIndex = this.buffer.indexOf("\r\n\r\n");
			if (headerSeparatorIndex === -1) {
				break;
			}

			const headerString = this.buffer.subarray(0, headerSeparatorIndex).toString("utf8");
			const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(headerString);
			if (!contentLengthMatch) {
				// Malformed header, skip
				this.buffer = this.buffer.subarray(headerSeparatorIndex + 4);
				continue;
			}

			const contentLength = Number.parseInt(contentLengthMatch[1], 10);
			const messageStart = headerSeparatorIndex + 4;
			const messageEnd = messageStart + contentLength;

			if (this.buffer.length < messageEnd) {
				// Incomplete message body in buffer, wait for more chunks
				break;
			}

			const messageBody = this.buffer.subarray(messageStart, messageEnd).toString("utf8");
			this.buffer = this.buffer.subarray(messageEnd);

			try {
				const parsed = JSON.parse(messageBody);
				this.handleMessage(parsed);
			} catch {
				// Ignore JSON parse errors
			}
		}
	}

	public handleMessage(message: Record<string, unknown>): void {
		// Response
		if ("id" in message && message.id !== undefined && message.id !== null) {
			const id = message.id as number | string;
			const pending = this.pendingRequests.get(id);
			if (pending) {
				this.pendingRequests.delete(id);
				clearTimeout(pending.timer);
				if ("error" in message && message.error) {
					const errorObj = message.error as { message: string };
					pending.reject(new Error(errorObj.message || "LSP request failed"));
				} else {
					pending.resolve(message.result);
				}
			}
			return;
		}

		// Notification
		if ("method" in message) {
			const method = message.method as string;
			if (method === "textDocument/publishDiagnostics") {
				const params = message.params as PublishDiagnosticsParams | undefined;
				if (params?.uri) {
					this.diagnosticsCache.set(params.uri, params.diagnostics);
					const waiters = this.diagnosticWaiters.get(params.uri);
					if (waiters && waiters.length > 0) {
						this.diagnosticWaiters.delete(params.uri);
						for (const waiter of waiters) {
							waiter(params.diagnostics);
						}
					}
				}
			}
		}
	}
}
