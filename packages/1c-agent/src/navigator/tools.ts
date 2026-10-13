import * as fs from "node:fs";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { BslLspClient } from "../lsp/client.ts";
import { parseBslSymbols } from "./ast-parser.ts";
import { CallHierarchyNavigator } from "./call-hierarchy.ts";
import { ImpactAnalyzer } from "./impact-analysis.ts";

export function registerNavigatorTools(pi: ExtensionAPI, lspClient?: BslLspClient, projectRoot?: string): void {
	const callHierarchyNavigator = new CallHierarchyNavigator(lspClient);
	const impactAnalyzer = new ImpactAnalyzer(projectRoot);

	// 1. 1c_call_hierarchy
	pi.registerTool({
		name: "1c_call_hierarchy",
		label: "1C Call Hierarchy",
		description:
			"Анализ иерархии вызовов для процедуры или функции 1С (кто вызывает данный метод и кого вызывает он).",
		promptSnippet: "1c_call_hierarchy: просмотр входящих и исходящих вызовов метода BSL",
		parameters: Type.Object({
			filePath: Type.String({ description: "Путь к файлу модуля .bsl" }),
			symbolName: Type.String({ description: "Имя процедуры или функции" }),
			direction: Type.Optional(
				Type.Union([Type.Literal("incoming"), Type.Literal("outgoing"), Type.Literal("both")], {
					description: "Направление вызовов: incoming, outgoing или both (по умолчанию both)",
				}),
			),
		}),
		execute: async (
			_toolCallId: string,
			params: { filePath: string; symbolName: string; direction?: "incoming" | "outgoing" | "both" },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const direction = params.direction || "both";
			const result = await callHierarchyNavigator.getCallHierarchy(params.filePath, params.symbolName, projectRoot);

			const lines: string[] = [`Иерархия вызовов для '${result.symbol}' в файле ${result.filePath}:`];

			if (direction === "incoming" || direction === "both") {
				lines.push(`\nВходящие вызовы (кто вызывает '${result.symbol}'): ${result.incomingCalls.length}`);
				if (result.incomingCalls.length === 0) {
					lines.push("  (нет обнаруженных вызовов)");
				} else {
					for (const call of result.incomingCalls) {
						lines.push(`  <- ${call.caller} (${call.filePath}:${call.line})`);
					}
				}
			}

			if (direction === "outgoing" || direction === "both") {
				lines.push(`\nИсходящие вызовы (кого вызывает '${result.symbol}'): ${result.outgoingCalls.length}`);
				if (result.outgoingCalls.length === 0) {
					lines.push("  (нет обнаруженных вызовов)");
				} else {
					for (const call of result.outgoingCalls) {
						lines.push(`  -> ${call.callee} (${call.filePath}:${call.line})`);
					}
				}
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: result,
			};
		},
	});

	// 2. 1c_impact_analysis
	pi.registerTool({
		name: "1c_impact_analysis",
		label: "1C Impact Analysis",
		description:
			"Анализ связанности и влияния изменений: выявление зависимостей между модулями BSL, документами, регистрами и обработчиками проведения.",
		promptSnippet: "1c_impact_analysis: анализ связанности и влияния изменений на регистры и проведение",
		parameters: Type.Object({
			target: Type.String({
				description: "Имя анализируемого метода, реквизита, регистра или метаданных",
			}),
			projectRoot: Type.Optional(Type.String({ description: "Корневой каталог проекта 1С (опционально)" })),
		}),
		execute: async (
			_toolCallId: string,
			params: { target: string; projectRoot?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const report = await impactAnalyzer.analyzeImpact(params.target, params.projectRoot);

			const lines: string[] = [
				`[Отчет о влиянии изменений для '${report.target}']`,
				report.summary,
				`\nДетальные ссылки (${report.references.length}):`,
			];

			for (const ref of report.references.slice(0, 50)) {
				lines.push(`- [${ref.contextType.toUpperCase()}] ${ref.filePath}:${ref.line} -> ${ref.snippet}`);
			}
			if (report.references.length > 50) {
				lines.push(`... и еще ${report.references.length - 50} ссылок скрыто.`);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: report,
			};
		},
	});

	// 3. 1c_ast_symbols
	pi.registerTool({
		name: "1c_ast_symbols",
		label: "1C AST Symbols",
		description:
			"Быстрое синтаксическое извлечение процедур, функций, директив (&НаСервере/&НаКлиенте), параметров и текстов SDBL-запросов из модуля 1С.",
		promptSnippet: "1c_ast_symbols: быстрое извлечение символов, процедур, директив и запросов из модуля BSL",
		parameters: Type.Object({
			filePath: Type.Optional(Type.String({ description: "Путь к файлу модуля .bsl" })),
			code: Type.Optional(Type.String({ description: "Исходный код BSL (если filePath не указан)" })),
		}),
		execute: async (
			_toolCallId: string,
			params: { filePath?: string; code?: string },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			let sourceCode = params.code || "";
			if (!sourceCode && params.filePath) {
				try {
					sourceCode = await fs.promises.readFile(params.filePath, "utf8");
				} catch (err: unknown) {
					const msg = err instanceof Error ? err.message : String(err);
					return {
						content: [{ type: "text", text: `Ошибка чтения файла: ${msg}` }],
						isError: true,
						details: undefined,
					};
				}
			}

			if (!sourceCode) {
				return {
					content: [{ type: "text", text: "Необходимо указать filePath или передать code" }],
					isError: true,
					details: undefined,
				};
			}

			const symbols = parseBslSymbols(sourceCode);
			const lines: string[] = [`Обнаружено процедур/функций: ${symbols.length}`];

			for (const sym of symbols) {
				const dirStr = sym.directive ? `${sym.directive} ` : "";
				const exportStr = sym.isExport ? " Экспорт" : "";
				const paramsStr = sym.parameters
					.map((p) => `${p.byValue ? "Знач " : ""}${p.name}${p.defaultValue ? ` = ${p.defaultValue}` : ""}`)
					.join(", ");
				const queriesCount = sym.queries.length > 0 ? ` [SDBL-запросов: ${sym.queries.length}]` : "";
				const callsCount = sym.calls.length > 0 ? ` [Вызовов: ${sym.calls.length}]` : "";

				lines.push(
					`- Строка ${sym.startLine}-${sym.endLine}: ${dirStr}${sym.type} ${sym.name}(${paramsStr})${exportStr}${queriesCount}${callsCount}`,
				);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: symbols,
			};
		},
	});
}
