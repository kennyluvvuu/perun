import { execFile } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { resolveBslAnalyzerPath } from "../toolchain/resolver.ts";
import type { LspDiagnostic, LspDiagnosticSeverity } from "../types.ts";
import type { BslLspClient } from "./client.ts";

const execFileAsync = promisify(execFile);

export interface InlineFeedbackOptions {
	waitForDiagnosticsTimeoutMs?: number;
	alwaysShowCleanNotice?: boolean;
	bslAnalyzerPath?: string;
}

function parseSeverity(severity?: string | number): LspDiagnosticSeverity {
	if (typeof severity === "number") {
		return severity >= 1 && severity <= 4 ? (severity as LspDiagnosticSeverity) : 2;
	}
	if (!severity) return 2;
	switch (severity.toLowerCase()) {
		case "critical":
		case "error":
			return 1;
		case "warning":
			return 2;
		case "info":
		case "information":
			return 3;
		case "hint":
			return 4;
		default:
			return 2;
	}
}

export function formatSeverity(severity?: LspDiagnosticSeverity): string {
	switch (severity) {
		case 1:
			return "ОШИБКА";
		case 2:
			return "ПРЕДУПРЕЖДЕНИЕ";
		case 3:
			return "ИНФО";
		case 4:
			return "ПОДСКАЗКА";
		default:
			return "ЗАМЕЧАНИЕ";
	}
}

export function formatDiagnostics(
	filePath: string,
	diagnostics: readonly LspDiagnostic[],
	source: "LSP" | "CLI" = "LSP",
): string {
	const prefix = source === "LSP" ? "[bsl-analyzer LSP]" : "[bsl-analyzer]";
	if (diagnostics.length === 0) {
		return `\n${prefix}: Файл ${filePath} проверен. Ошибок синтаксиса и стандартов ИТС не обнаружено.`;
	}

	const lines: string[] = [`\n${prefix}: В файле ${filePath} обнаружены замечания (${diagnostics.length}):`];

	for (const diag of diagnostics) {
		const line = diag.range.start.line + 1;
		const col = diag.range.start.character + 1;
		const sev = formatSeverity(diag.severity);
		const code = diag.code ? ` (${diag.code})` : "";
		lines.push(`- [Строка ${line}, Кол ${col}] ${sev}${code}: ${diag.message}`);
	}

	lines.push("\nРекомендация: Пожалуйста, устраните указанные замечания перед завершением текущего шага.");

	return lines.join("\n");
}

export class InlineFeedbackHandler {
	private readonly client: BslLspClient;
	private readonly options: InlineFeedbackOptions;

	constructor(client: BslLspClient, options: InlineFeedbackOptions = {}) {
		this.client = client;
		this.options = {
			waitForDiagnosticsTimeoutMs: options.waitForDiagnosticsTimeoutMs ?? 250,
			alwaysShowCleanNotice: options.alwaysShowCleanNotice ?? true,
			bslAnalyzerPath: options.bslAnalyzerPath,
		};
	}

	public isBslFile(filePath: string): boolean {
		const lower = filePath.toLowerCase();
		return lower.endsWith(".bsl") || lower.endsWith(".os");
	}

	public parseCliDiagnostics(output: string): readonly LspDiagnostic[] {
		const diagnostics: LspDiagnostic[] = [];
		const trimmedOutput = output.trim();
		if (!trimmedOutput) return diagnostics;

		if (trimmedOutput.startsWith("[") || (trimmedOutput.startsWith("{") && !trimmedOutput.includes("\n{"))) {
			try {
				const parsed = JSON.parse(trimmedOutput);
				const items: unknown[] = Array.isArray(parsed)
					? parsed
					: Array.isArray(parsed.diagnostics)
						? parsed.diagnostics
						: [];
				for (const item of items) {
					const d = item as {
						start_line?: number;
						start_column?: number;
						end_line?: number;
						end_column?: number;
						line?: number;
						column?: number;
						severity?: string | number;
						code?: string;
						message?: string;
					};
					const startLine = d.start_line ?? (d.line !== undefined ? Math.max(0, d.line - 1) : 0);
					const startCol = d.start_column ?? (d.column !== undefined ? Math.max(0, d.column - 1) : 0);
					const endLine = d.end_line ?? (d.line !== undefined ? Math.max(0, d.line - 1) : startLine);
					const endCol = d.end_column ?? (d.column !== undefined ? Math.max(0, d.column - 1) : startCol);
					diagnostics.push({
						range: {
							start: { line: startLine, character: startCol },
							end: { line: endLine, character: endCol },
						},
						severity: parseSeverity(d.severity),
						code: d.code,
						message: d.message || "Замечание bsl-analyzer",
					});
				}
				if (diagnostics.length > 0) {
					return diagnostics;
				}
			} catch {
				// Fall through to line-by-line parsing
			}
		}

		const lines = output.split(/\r?\n/);
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;

			if (trimmed.startsWith("{")) {
				try {
					const parsed = JSON.parse(trimmed);
					if (parsed.type === "file" && Array.isArray(parsed.diagnostics)) {
						for (const d of parsed.diagnostics) {
							diagnostics.push({
								range: {
									start: { line: d.start_line ?? 0, character: d.start_column ?? 0 },
									end: {
										line: d.end_line ?? d.start_line ?? 0,
										character: d.end_column ?? d.start_column ?? 0,
									},
								},
								severity: parseSeverity(d.severity),
								code: d.code,
								message: d.message || "Замечание bsl-analyzer",
							});
						}
					}
				} catch {
					// Ignore line JSON parse error
				}
			} else {
				const match = /(?:^|\s)(?:.+?):(\d+):(\d+):\s*(error|warning|info|hint)\s*(?:\(([^)]+)\))?:\s*(.+)$/i.exec(
					trimmed,
				);
				if (match) {
					const lineNum = Math.max(0, Number.parseInt(match[1], 10) - 1);
					const colNum = Math.max(0, Number.parseInt(match[2], 10) - 1);
					diagnostics.push({
						range: {
							start: { line: lineNum, character: colNum },
							end: { line: lineNum, character: colNum },
						},
						severity: parseSeverity(match[3]),
						code: match[4],
						message: match[5].trim(),
					});
				}
			}
		}

		return diagnostics;
	}

	public async runCliAnalysis(executablePath: string, filePath: string): Promise<readonly LspDiagnostic[]> {
		try {
			let res = await execFileAsync(executablePath, ["analyze", "-s", filePath, "--format", "jsonl"], {
				timeout: 10000,
				maxBuffer: 10 * 1024 * 1024,
			}).catch((err: { stdout?: string; stderr?: string }) => ({
				stdout: err.stdout ?? "",
				stderr: err.stderr ?? "",
			}));

			if (!res.stdout && (res.stderr.includes("--format") || res.stderr.includes("unexpected"))) {
				res = await execFileAsync(executablePath, ["analyze", "-s", filePath], {
					timeout: 10000,
					maxBuffer: 10 * 1024 * 1024,
				}).catch((err: { stdout?: string; stderr?: string }) => ({
					stdout: err.stdout ?? "",
					stderr: err.stderr ?? "",
				}));
			}

			const output = res.stdout || res.stderr;
			return this.parseCliDiagnostics(output);
		} catch {
			return [];
		}
	}

	public async handleToolResult(
		event: ToolResultEvent,
	): Promise<{ content?: (TextContent | ImageContent)[] } | undefined> {
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const rawPath =
			(event.input as { path?: string; file_path?: string }).path ||
			(event.input as { path?: string; file_path?: string }).file_path;
		if (!rawPath || typeof rawPath !== "string") {
			return undefined;
		}

		if (!this.isBslFile(rawPath)) {
			return undefined;
		}

		// Read updated file content
		let updatedContent = "";
		try {
			updatedContent = await fs.promises.readFile(rawPath, "utf8");
		} catch {
			return undefined;
		}

		if (this.client.isReady()) {
			// Ensure document is opened and changed in LSP
			await this.client.openDocument(rawPath, updatedContent);
			await this.client.changeDocument(rawPath, updatedContent);

			// Wait for diagnostics from bsl-analyzer
			const diagnostics = await this.client.waitForDiagnostics(rawPath, this.options.waitForDiagnosticsTimeoutMs);

			if (diagnostics.length === 0 && !this.options.alwaysShowCleanNotice) {
				return undefined;
			}

			const feedbackText = formatDiagnostics(rawPath, diagnostics, "LSP");

			return {
				content: [...(event.content ?? []), { type: "text", text: feedbackText }],
			};
		}

		// LSP client is not active: CLI-fallback
		const bslAnalyzer = resolveBslAnalyzerPath(this.options.bslAnalyzerPath);
		if (!bslAnalyzer) {
			const feedbackText = "\n[bsl-analyzer]: Статический анализ недоступен (bsl-analyzer не обнаружен)";
			return {
				content: [...(event.content ?? []), { type: "text", text: feedbackText }],
			};
		}

		const cliDiagnostics = await this.runCliAnalysis(bslAnalyzer, rawPath);
		if (cliDiagnostics.length === 0 && !this.options.alwaysShowCleanNotice) {
			return undefined;
		}

		const feedbackText = formatDiagnostics(rawPath, cliDiagnostics, "CLI");

		return {
			content: [...(event.content ?? []), { type: "text", text: feedbackText }],
		};
	}
}
