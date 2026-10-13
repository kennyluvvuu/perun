import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SUBAGENT_ROLES } from "../src/subagents/roles.ts";
import { registerSubagentTools } from "../src/subagents/tools.ts";

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

		const coder = SUBAGENT_ROLES["1c-coder"];
		expect(coder.title).toContain("Разработчик BSL");
		expect(coder.systemPrompt).toContain("QueryInLoop");
		expect(coder.allowedTools).toContain("bsl_fix_standards");

		const tester = SUBAGENT_ROLES["1c-tester"];
		expect(tester.title).toContain("Инженер тестирования");
		expect(tester.systemPrompt).toContain("YAXUnit");
		expect(tester.systemPrompt).toContain(".ВТранзакции()");

		const reviewer = SUBAGENT_ROLES["1c-reviewer"];
		expect(reviewer.title).toContain("Ревьюер");
		expect(reviewer.systemPrompt).toContain("стандартам разработки 1С:ИТС");
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
});
