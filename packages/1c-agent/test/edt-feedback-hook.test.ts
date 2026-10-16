// Тест хука tool_result: после edit/write файла .mdo замечания проверки добавляются к результату инструмента.

import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext, ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOnecAgentExtension } from "../src/index.ts";
import { createEdtFixture, type EdtFixture } from "./helpers/edt-fixture.ts";

type Handler = (
	event: ToolResultEvent,
	ctx: ExtensionContext,
) => Promise<{ content?: Array<{ type: string; text?: string }> } | undefined>;

describe("edt: tool_result hook", () => {
	let fixture: EdtFixture;
	let onToolResult: Handler;

	beforeEach(() => {
		fixture = createEdtFixture();
		const pi = {
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
			registerShortcut: vi.fn(),
			on: vi.fn((event: string, handler: Handler) => {
				if (event === "tool_result") onToolResult = handler;
				return () => undefined;
			}),
			getActiveTools: vi.fn(() => []),
			setActiveTools: vi.fn(),
		} as unknown as ExtensionAPI;
		createOnecAgentExtension({
			projectRoot: fixture.workspace,
			memoryDbPath: path.join(fixture.workspace, "memory.db"),
			docsDbPath: path.join(fixture.workspace, "docs.db"),
		})(pi);
	});

	afterEach(() => fixture.cleanup());

	function editEvent(relativePath: string): ToolResultEvent {
		return {
			type: "tool_result",
			toolName: "edit",
			toolCallId: "call",
			input: { path: path.join("configuration", relativePath) },
			content: [{ type: "text", text: "Файл изменён" }],
			isError: false,
			details: undefined,
		} as unknown as ToolResultEvent;
	}

	it("appends .mdo diagnostics after an edit that breaks references", async () => {
		const subsystem = "src/Subsystems/Склад/Склад.mdo";
		fixture.write(
			subsystem,
			fixture
				.read(subsystem)
				.replace("</mdclass:Subsystem>", "  <content>Catalog.Нет</content>\n</mdclass:Subsystem>"),
		);
		const result = await onToolResult(editEvent(subsystem), { cwd: fixture.workspace } as ExtensionContext);
		const texts = result?.content?.map((item) => item.text ?? "") ?? [];
		expect(texts[0]).toBe("Файл изменён");
		expect(texts[1]).toContain("[проверка .mdo]");
		expect(texts[1]).toContain("несуществующий объект Catalog.Нет");
	});

	it("leaves the result untouched for a correct .mdo", async () => {
		const result = await onToolResult(editEvent("src/Subsystems/Склад/Склад.mdo"), {
			cwd: fixture.workspace,
		} as ExtensionContext);
		expect(result).toBeUndefined();
	});
});
