import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BslLspClient } from "../src/lsp/client.ts";
import { formatDiagnostics, InlineFeedbackHandler } from "../src/lsp/feedback.ts";
import type { LspDiagnostic } from "../src/types.ts";

describe("Inline LSP Feedback", () => {
	let tempDir: string;
	let bslFile: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "1c-feedback-test-"));
		bslFile = path.join(tempDir, "DocumentPosting.bsl");
		await fs.promises.writeFile(
			bslFile,
			`Процедура ОбработкаПроведения(Отказ, Режим) Экспорт
	Для Каждого Стр Из ТаблицаТоваров Цикл
		Запрос = Новый Запрос;
		Запрос.Текст = "ВЫБРАТЬ 1";
		Запрос.Выполнить();
	КонецЦикла;
КонецПроцедуры`,
			"utf8",
		);
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("formats diagnostics with Russian severity labels and coordinates", () => {
		const diagnostics: LspDiagnostic[] = [
			{
				range: { start: { line: 4, character: 2 }, end: { line: 4, character: 20 } },
				severity: 1,
				code: "QueryInLoop",
				message: "Запрос в цикле запрещен стандартом ИТС",
			},
		];

		const formatted = formatDiagnostics("DocumentPosting.bsl", diagnostics);
		expect(formatted).toContain("[bsl-analyzer LSP]: В файле DocumentPosting.bsl обнаружены замечания (1):");
		expect(formatted).toContain("[Строка 5, Кол 3] ОШИБКА (QueryInLoop): Запрос в цикле запрещен стандартом ИТС");
		expect(formatted).toContain("Пожалуйста, устраните указанные замечания перед завершением текущего шага.");
	});

	it("ignores non-BSL files (e.g. .ts, .json)", async () => {
		const client = new BslLspClient({ projectPath: tempDir });
		const handler = new InlineFeedbackHandler(client);

		const event: ToolResultEvent = {
			type: "tool_result",
			toolName: "write",
			toolCallId: "call_1",
			input: { path: "/project/src/index.ts" },
			content: [{ type: "text", text: "File written successfully" }],
			isError: false,
			details: undefined,
		};

		const result = await handler.handleToolResult(event);
		expect(result).toBeUndefined();
	});

	it("attaches LSP diagnostics to tool_result content for .bsl files", async () => {
		const client = new BslLspClient({ projectPath: tempDir });
		const handler = new InlineFeedbackHandler(client, { waitForDiagnosticsTimeoutMs: 100 });

		// Mock waitForDiagnostics to simulate bsl-analyzer returning an error
		vi.spyOn(client, "waitForDiagnostics").mockResolvedValue([
			{
				range: { start: { line: 4, character: 2 }, end: { line: 4, character: 20 } },
				severity: 1,
				code: "QueryInLoop",
				message: "Запрос внутри цикла",
			},
		]);

		const event: ToolResultEvent = {
			type: "tool_result",
			toolName: "write",
			toolCallId: "call_2",
			input: { path: bslFile },
			content: [{ type: "text", text: "Successfully saved DocumentPosting.bsl" }],
			isError: false,
			details: undefined,
		};

		const result = await handler.handleToolResult(event);
		expect(result).toBeDefined();
		expect(result?.content).toHaveLength(2);
		const firstBlock = result?.content?.[0];
		const secondBlock = result?.content?.[1];
		expect(firstBlock?.type).toBe("text");
		expect(secondBlock?.type).toBe("text");
		if (firstBlock?.type === "text" && secondBlock?.type === "text") {
			expect(firstBlock.text).toBe("Successfully saved DocumentPosting.bsl");
			expect(secondBlock.text).toContain("[bsl-analyzer LSP]: В файле");
			expect(secondBlock.text).toContain("QueryInLoop");
		}
	});

	it("returns undefined when file has no diagnostics and clean notice is disabled", async () => {
		const client = new BslLspClient({ projectPath: tempDir });
		const handler = new InlineFeedbackHandler(client, { alwaysShowCleanNotice: false });

		vi.spyOn(client, "waitForDiagnostics").mockResolvedValue([]);

		const event: ToolResultEvent = {
			type: "tool_result",
			toolName: "edit",
			toolCallId: "call_3",
			input: { path: bslFile },
			content: [{ type: "text", text: "Edit applied" }],
			isError: false,
			details: undefined,
		};

		const result = await handler.handleToolResult(event);
		expect(result).toBeUndefined();
	});
});
