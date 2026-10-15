import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBAGENT_ROLES } from "../src/subagents/roles.ts";
import { registerSubagentTools, sanitizeSubagentOutput } from "../src/subagents/tools.ts";

describe("1C Subagents", () => {
	let tempDir: string;
	let contextFile: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "1c-subagent-test-"));
		contextFile = path.join(tempDir, "ContextModule.bsl");
		await fs.promises.writeFile(
			contextFile,
			`Процедура ТестовыйМетод() Экспорт
КонецПроцедуры`,
			"utf8",
		);
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("has all 4 specialized 1C roles configured with correct tools and prompts", () => {
		const roles = Object.keys(SUBAGENT_ROLES);
		expect(roles).toEqual(["1c-architect", "1c-coder", "1c-tester", "1c-reviewer"]);

		const architect = SUBAGENT_ROLES["1c-architect"];
		expect(architect.title).toContain("Архитектор");
		expect(architect.systemPrompt).toContain("1C:EDT");
		expect(architect.allowedTools).toContain("1c_impact_analysis");
		expect(architect.allowedTools).toContain("1c_call_hierarchy");
		expect(architect.systemPrompt).toContain("1c_vanessa");
		expect(architect.systemPrompt).toContain("TOOLCHAIN-RESOLVER");
		expect(architect.systemPrompt).toContain("CC-1C-SKILLS");
		expect(architect.systemPrompt).toContain("СТРОГИЙ ЗАПРЕТ СЫРОЙ РАЗМЕТКИ TOOL-CALL И DSML");

		const coder = SUBAGENT_ROLES["1c-coder"];
		expect(coder.title).toContain("Разработчик BSL");
		expect(coder.systemPrompt).toContain("QueryInLoop");
		expect(coder.allowedTools).toContain("bsl_fix_standards");
		expect(coder.systemPrompt).toContain("1c_vanessa");
		expect(coder.systemPrompt).toContain("TOOLCHAIN-RESOLVER");
		expect(coder.systemPrompt).toContain("CC-1C-SKILLS");
		expect(coder.systemPrompt).toContain("СТРОГИЙ ЗАПРЕТ СЫРОЙ РАЗМЕТКИ TOOL-CALL И DSML");

		const tester = SUBAGENT_ROLES["1c-tester"];
		expect(tester.title).toContain("Инженер тестирования");
		expect(tester.systemPrompt).toContain("YAXUnit");
		expect(tester.systemPrompt).toContain(".ВТранзакции()");
		expect(tester.allowedTools).toContain("1c_vanessa");
		expect(tester.systemPrompt).toContain("1c_vanessa");
		expect(tester.systemPrompt).toContain("dbUser");
		expect(tester.systemPrompt).toContain("dbPassword");
		expect(tester.systemPrompt).toContain("СТРОГИЙ ЗАПРЕТ СЫРОЙ РАЗМЕТКИ TOOL-CALL И DSML");

		const reviewer = SUBAGENT_ROLES["1c-reviewer"];
		expect(reviewer.title).toContain("Ревьюер");
		expect(reviewer.systemPrompt).toContain("стандартам разработки 1С:ИТС");
		expect(reviewer.systemPrompt).toContain("1c_vanessa");
		expect(reviewer.systemPrompt).toContain("meta-validate");
		expect(reviewer.systemPrompt).toContain("СТРОГИЙ ЗАПРЕТ СЫРОЙ РАЗМЕТКИ TOOL-CALL И DSML");
	});

	it("delegates task to subagent and returns structured output", async () => {
		let registeredTool: any;
		const mockPi = {
			registerTool: vi.fn((tool) => {
				registeredTool = tool;
			}),
		} as unknown as ExtensionAPI;

		registerSubagentTools(mockPi);
		expect(registeredTool).toBeDefined();

		const result = await registeredTool.execute(
			"call_subagent_1",
			{
				role: "1c-architect",
				task: "Спроектировать регистр накопления 'ОстаткиТоваров' для складского учета",
				contextFiles: [contextFile],
			},
			undefined,
			undefined,
			{} as ExtensionToolContext,
		);

		expect(result.content[0].text).toContain("СУБАГЕНТ 1C АРХИТЕКТОР МЕТАДАННЫХ");
		expect(result.details.role).toBe("1c-architect");
		expect(result.details.task).toContain("ОстаткиТоваров");
	});

	it("rejects invalid subagent roles", async () => {
		let registeredTool: any;
		const mockPi = {
			registerTool: vi.fn((tool) => {
				registeredTool = tool;
			}),
		} as unknown as ExtensionAPI;

		registerSubagentTools(mockPi);

		const result = await registeredTool.execute(
			"call_subagent_2",
			{
				role: "invalid-role" as any,
				task: "Некорректная задача",
			},
			undefined,
			undefined,
			{} as ExtensionToolContext,
		);

		expect(result.isError).toBe(true);
		expect(result.content[0].text).toContain("Неизвестная роль");
	});

	it("streams response from modelRegistry when available", async () => {
		let registeredTool: any;
		const mockPi = {
			registerTool: vi.fn((tool) => {
				registeredTool = tool;
			}),
		} as unknown as ExtensionAPI;

		registerSubagentTools(mockPi);

		// Mock modelRegistry
		async function* fakeStream() {
			yield { type: "text_delta", delta: "Сгенерированный " };
			yield { type: "text_delta", delta: "ответ архитектора." };
		}

		const mockCtx = {
			model: { id: "mock-model" } as any,
			modelRegistry: {
				streamSimple: vi.fn(() => fakeStream()),
			},
		} as unknown as ExtensionToolContext;

		const result = await registeredTool.execute(
			"call_subagent_3",
			{
				role: "1c-coder",
				task: "Написать процедуру проведения",
			},
			undefined,
			undefined,
			mockCtx,
		);

		expect(result.content[0].text).toBe("Сгенерированный ответ архитектора.");
		expect(mockCtx.modelRegistry.streamSimple).toHaveBeenCalled();
	});

	it("sanitizes DSML markup and raw tool calls into structured text", () => {
		// 1. DSML with JSON invoke
		const dsmlWithJson = `Анализ влияния:
<｜｜DSML｜｜ <invoke name="1c_impact_analysis">{"target": "ОстаткиТоваров"}</invoke> ｜｜>
Результат проверки: регистр затронут проведением.`;
		const sanitized1 = sanitizeSubagentOutput(dsmlWithJson);
		expect(sanitized1).not.toContain("<｜｜DSML｜｜");
		expect(sanitized1).not.toContain("｜｜>");
		expect(sanitized1).toContain('[Вызов инструмента: 1c_impact_analysis(target: "ОстаткиТоваров")]');
		expect(sanitized1).toContain("Анализ влияния:");
		expect(sanitized1).toContain("Результат проверки: регистр затронут проведением.");

		// 2. DSML with XML parameter tags
		const dsmlWithParams = `<｜｜DSML｜｜
<invoke name="1c_call_hierarchy">
<parameter name="filePath">CommonModules/Common.bsl</parameter>
<parameter name="symbolName">РассчитатьСкидку</parameter>
</invoke>
｜｜>`;
		const sanitized2 = sanitizeSubagentOutput(dsmlWithParams);
		expect(sanitized2).not.toContain("<｜｜DSML｜｜");
		expect(sanitized2).not.toContain("<invoke");
		expect(sanitized2).toContain(
			'[Вызов инструмента: 1c_call_hierarchy(filePath: "CommonModules/Common.bsl", symbolName: "РассчитатьСкидку")]',
		);

		// 3. XML tool_call tag
		const xmlToolCall = `Предварительный вызов:
<tool_call>
{"name": "read", "arguments": {"path": "Documents/Sales.bsl"}}
</tool_call>`;
		const sanitized3 = sanitizeSubagentOutput(xmlToolCall);
		expect(sanitized3).not.toContain("<tool_call>");
		expect(sanitized3).toContain('[Вызов инструмента: read(path: "Documents/Sales.bsl")]');

		// 4. DeepSeek tool call tokens
		const deepSeekToolCall = `<｜tool calls begin｜><｜tool_call begin｜>function<｜tool_sep｜>1c_ast_symbols
\`\`\`json
{"filePath": "Ext/Module.bsl"}
\`\`\`<｜tool_call end｜><｜tool calls end｜>`;
		const sanitized4 = sanitizeSubagentOutput(deepSeekToolCall);
		expect(sanitized4).not.toContain("tool calls begin");
		expect(sanitized4).not.toContain("tool_call begin");
		expect(sanitized4).toContain('[Вызов инструмента: 1c_ast_symbols(filePath: "Ext/Module.bsl")]');

		// 5. Plain text with leftover DSML markers
		const leftoverDsml = "<｜｜DSML｜｜Текст без вызова инструментов｜｜>";
		const sanitized5 = sanitizeSubagentOutput(leftoverDsml);
		expect(sanitized5).toBe("Текст без вызова инструментов");

		// 6. BSL code is preserved untouched
		const bslCode = `Процедура ОбработкаПроведения(Отказ, РежимПроведения)
	Блокировка = Новый БлокировкаДанных;
КонецПроцедуры`;
		expect(sanitizeSubagentOutput(bslCode)).toBe(bslCode);
	});

	it("filters DSML markup when streaming from modelRegistry in subagent execution", async () => {
		let registeredTool: any;
		const mockPi = {
			registerTool: vi.fn((tool) => {
				registeredTool = tool;
			}),
		} as unknown as ExtensionAPI;

		registerSubagentTools(mockPi);

		async function* fakeStreamWithDsml() {
			yield { type: "text_delta", delta: "Рекомендация субагента:\n" };
			yield {
				type: "text_delta",
				delta: '<｜｜DSML｜｜ <invoke name="1c_impact_analysis">{"target": "Регистр"}</invoke> ｜｜>\n',
			};
			yield { type: "text_delta", delta: "Анализ завершен." };
		}

		const mockCtx = {
			model: { id: "mock-model" } as any,
			modelRegistry: {
				streamSimple: vi.fn(() => fakeStreamWithDsml()),
			},
		} as unknown as ExtensionToolContext;

		const result = await registeredTool.execute(
			"call_subagent_dsml",
			{
				role: "1c-reviewer",
				task: "Проверить влияние изменений",
			},
			undefined,
			undefined,
			mockCtx,
		);

		expect(result.content[0].text).not.toContain("<｜｜DSML｜｜");
		expect(result.content[0].text).toContain('[Вызов инструмента: 1c_impact_analysis(target: "Регистр")]');
		expect(result.content[0].text).toContain("Анализ завершен.");
		expect(result.details.output).toBe(result.content[0].text);
	});
});
