import * as fs from "node:fs";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import type { LspDiagnostic, LspDiagnosticSeverity } from "../types.ts";
import type { BslLspClient } from "./client.ts";

export interface InlineFeedbackOptions {
	waitForDiagnosticsTimeoutMs?: number;
	alwaysShowCleanNotice?: boolean;
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

export function formatDiagnostics(filePath: string, diagnostics: readonly LspDiagnostic[]): string {
	if (diagnostics.length === 0) {
		return `\n[bsl-analyzer LSP]: Файл ${filePath} проверен. Ошибок синтаксиса и стандартов ИТС не обнаружено.`;
	}

	const lines: string[] = [`\n[bsl-analyzer LSP]: В файле ${filePath} обнаружены замечания (${diagnostics.length}):`];

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
			alwaysShowCleanNotice: options.alwaysShowCleanNotice ?? false,
		};
	}

	public isBslFile(filePath: string): boolean {
		const lower = filePath.toLowerCase();
		return lower.endsWith(".bsl") || lower.endsWith(".os");
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

		// Ensure document is opened and changed in LSP
		await this.client.openDocument(rawPath, updatedContent);
		await this.client.changeDocument(rawPath, updatedContent);

		// Wait for diagnostics from bsl-analyzer
		const diagnostics = await this.client.waitForDiagnostics(rawPath, this.options.waitForDiagnosticsTimeoutMs);

		if (diagnostics.length === 0 && !this.options.alwaysShowCleanNotice) {
			return undefined;
		}

		const feedbackText = formatDiagnostics(rawPath, diagnostics);

		return {
			content: [...event.content, { type: "text", text: feedbackText }],
		};
	}
}
