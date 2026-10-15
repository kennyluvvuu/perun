import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BslLspClient } from "../src/lsp/client.ts";
import { formatDiagnostics, InlineFeedbackHandler } from "../src/lsp/feedback.ts";
import * as toolchainResolver from "../src/toolchain/resolver.ts";
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

		// Mock isReady and waitForDiagnostics to simulate bsl-analyzer LSP returning an error
		vi.spyOn(client, "isReady").mockReturnValue(true);
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

		vi.spyOn(client, "isReady").mockReturnValue(true);
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

	it("falls back to CLI analysis when LSP client is not ready (isReady === false)", async () => {
		const client = new BslLspClient({ projectPath: tempDir });
		const handler = new InlineFeedbackHandler(client);

		expect(client.isReady()).toBe(false);

		// Mock runCliAnalysis to return AmbiguousFieldInQuery diagnostic
		vi.spyOn(handler, "runCliAnalysis").mockResolvedValue([
			{
				range: { start: { line: 2, character: 1 }, end: { line: 2, character: 10 } },
				severity: 1,
				code: "AmbiguousFieldInQuery",
				message: "Неоднозначное поле в запросе",
			},
		]);

		const event: ToolResultEvent = {
			type: "tool_result",
			toolName: "write",
			toolCallId: "call_cli_1",
			input: { path: bslFile },
			content: [{ type: "text", text: "Saved DocumentPosting.bsl" }],
			isError: false,
			details: undefined,
		};

		const result = await handler.handleToolResult(event);
		expect(result).toBeDefined();
		expect(result?.content).toHaveLength(2);
		const secondBlock = result?.content?.[1];
		expect(secondBlock?.type).toBe("text");
		if (secondBlock?.type === "text") {
			expect(secondBlock.text).toContain("[bsl-analyzer]: В файле");
			expect(secondBlock.text).toContain("AmbiguousFieldInQuery");
			expect(secondBlock.text).toContain("Неоднозначное поле в запросе");
		}
	});

	it("reports static analysis unavailable when bsl-analyzer is not found in system", async () => {
		const client = new BslLspClient({ projectPath: tempDir });
		const handler = new InlineFeedbackHandler(client, { bslAnalyzerPath: undefined });

		expect(client.isReady()).toBe(false);

		const resolverSpy = vi.spyOn(toolchainResolver, "resolveBslAnalyzerPath").mockReturnValue(undefined);

		try {
			const event: ToolResultEvent = {
				type: "tool_result",
				toolName: "write",
				toolCallId: "call_cli_missing",
				input: { path: bslFile },
				content: [{ type: "text", text: "Saved file" }],
				isError: false,
				details: undefined,
			};

			const result = await handler.handleToolResult(event);
			expect(result).toBeDefined();
			const secondBlock = result?.content?.[1];
			expect(secondBlock?.type).toBe("text");
			if (secondBlock?.type === "text") {
				expect(secondBlock.text).toContain(
					"[bsl-analyzer]: Статический анализ недоступен (bsl-analyzer не обнаружен)",
				);
			}
		} finally {
			resolverSpy.mockRestore();
		}
	});

	it("shows clean check notice by default to prevent channel silence", async () => {
		const client = new BslLspClient({ projectPath: tempDir });
		const handler = new InlineFeedbackHandler(client);

		vi.spyOn(client, "isReady").mockReturnValue(true);
		vi.spyOn(client, "waitForDiagnostics").mockResolvedValue([]);

		const event: ToolResultEvent = {
			type: "tool_result",
			toolName: "edit",
			toolCallId: "call_clean_notice",
			input: { path: bslFile },
			content: [{ type: "text", text: "Clean edit" }],
			isError: false,
			details: undefined,
		};

		const result = await handler.handleToolResult(event);
		expect(result).toBeDefined();
		const secondBlock = result?.content?.[1];
		expect(secondBlock?.type).toBe("text");
		if (secondBlock?.type === "text") {
			expect(secondBlock.text).toContain("проверен. Ошибок синтаксиса и стандартов ИТС не обнаружено.");
		}
	});

	it("parses CLI diagnostics in JSONL, JSON array, and compiler format", () => {
		const client = new BslLspClient({ projectPath: tempDir });
		const handler = new InlineFeedbackHandler(client);

		// 1. JSONL format (bsl-analyzer --format jsonl)
		const jsonlOutput = `{"type":"start","total_files":1,"version":"0.3.2"}\n{"type":"file","path":"/path/Order.bsl","diagnostics":[{"code":"QueryInLoop","message":"Запрос в цикле","severity":"Critical","start_line":4,"start_column":2,"end_line":4,"end_column":20}]}\n{"type":"done"}`;
		const parsedJsonl = handler.parseCliDiagnostics(jsonlOutput);
		expect(parsedJsonl).toHaveLength(1);
		expect(parsedJsonl[0].code).toBe("QueryInLoop");
		expect(parsedJsonl[0].severity).toBe(1);
		expect(parsedJsonl[0].range.start.line).toBe(4);
		expect(parsedJsonl[0].range.start.character).toBe(2);

		// 2. JSON array format
		const jsonArray = JSON.stringify([
			{
				file: "Order.bsl",
				line: 10,
				column: 5,
				severity: "warning",
				code: "EmptyExcept",
				message: "Пустой блок исключения",
			},
		]);
		const parsedArray = handler.parseCliDiagnostics(jsonArray);
		expect(parsedArray).toHaveLength(1);
		expect(parsedArray[0].code).toBe("EmptyExcept");
		expect(parsedArray[0].severity).toBe(2);
		expect(parsedArray[0].range.start.line).toBe(9);
		expect(parsedArray[0].range.start.character).toBe(4);

		// 3. Compiler line format
		const compilerOutput = `/path/Order.bsl:12:8: error (ServerModalCall): Вызов модального окна на сервере`;
		const parsedCompiler = handler.parseCliDiagnostics(compilerOutput);
		expect(parsedCompiler).toHaveLength(1);
		expect(parsedCompiler[0].code).toBe("ServerModalCall");
		expect(parsedCompiler[0].severity).toBe(1);
		expect(parsedCompiler[0].range.start.line).toBe(11);
		expect(parsedCompiler[0].range.start.character).toBe(7);
	});
});
