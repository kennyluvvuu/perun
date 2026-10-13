import { exec } from "node:child_process";
import * as fs from "node:fs";
import { promisify } from "node:util";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { StandardFixResult } from "../types.ts";
import { generatePatches, generateUnifiedDiff } from "./patcher.ts";
import { analyzeCodeForItsRules, parseBslAnalyzerJsonOutput } from "./rules.ts";

const execAsync = promisify(exec);

export function registerAutofixTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "bsl_fix_standards",
		label: "BSL Standards Auto-Fixer",
		description:
			"Статический анализ кода 1С на соответствие стандартам ИТС и автоматическое применение безопасных diff-патчей (исправление пустых попыток, неиспользуемых переменных, BSLDoc и др.).",
		promptSnippet: "bsl_fix_standards: аудит стандартов 1С:ИТС и авто-исправление замечаний",
		parameters: Type.Object({
			target: Type.String({ description: "Путь к файлу .bsl или каталогу для проверки" }),
			dryRun: Type.Optional(
				Type.Boolean({
					description: "Только показать нарушения и предлагаемый diff без изменения файла (по умолчанию false)",
				}),
			),
			useCli: Type.Optional(
				Type.Boolean({
					description: "Запустить внешнюю утилиту bsl-analyzer CLI для анализа (по умолчанию false)",
				}),
			),
			ruleIds: Type.Optional(
				Type.Array(Type.String(), {
					description: "Ограничить проверку конкретными правилами (опционально)",
				}),
			),
		}),
		execute: async (
			_toolCallId: string,
			params: { target: string; dryRun?: boolean; useCli?: boolean; ruleIds?: string[] },
			_signal: AbortSignal | undefined,
			_onUpdate: unknown,
			_ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const dryRun = params.dryRun ?? false;
			const targetPath = params.target;

			let sourceCode = "";
			try {
				sourceCode = await fs.promises.readFile(targetPath, "utf8");
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Ошибка открытия файла '${targetPath}': ${msg}` }],
					isError: true,
					details: undefined,
				};
			}

			// 1. Run internal ITS rules analysis
			let violations = [...analyzeCodeForItsRules(targetPath, sourceCode)];

			// 2. Try running external bsl-analyzer analyze --format json if requested
			const useCli = params.useCli ?? process.env.BSL_ANALYZER_CLI === "1";
			if (useCli) {
				try {
					const { stdout } = await execAsync(`bsl-analyzer analyze --format json "${targetPath}"`, {
						timeout: 3000,
					});
					if (stdout.trim()) {
						const externalViolations = parseBslAnalyzerJsonOutput(stdout, targetPath);
						// Merge non-duplicate rule violations
						for (const ext of externalViolations) {
							if (!violations.some((v) => v.line === ext.line && v.ruleId === ext.ruleId)) {
								violations.push(ext);
							}
						}
					}
				} catch {
					// CLI bsl-analyzer not available or exited with code - use internal rules
				}
			}

			// Filter by ruleIds if specified
			if (params.ruleIds && params.ruleIds.length > 0) {
				const allowedSet = new Set(params.ruleIds);
				violations = violations.filter((v) => allowedSet.has(v.ruleId));
			}

			if (violations.length === 0) {
				return {
					content: [
						{
							type: "text",
							text: `[bsl_fix_standards]: В файле '${targetPath}' нарушений стандартов 1С:ИТС не обнаружено. Код соответствует стандарту.`,
						},
					],
					details: {
						filePath: targetPath,
						totalViolations: 0,
						appliedFixes: 0,
						remainingViolations: [],
					},
				};
			}

			// 3. Generate patches
			const { fixedContent, appliedCount } = generatePatches(targetPath, sourceCode, violations);
			const diff = generateUnifiedDiff(targetPath, sourceCode, fixedContent);

			if (!dryRun && appliedCount > 0) {
				await fs.promises.writeFile(targetPath, fixedContent, "utf8");
			}

			const remainingViolations = violations.filter((v) => !v.canAutoFix);

			const lines: string[] = [
				`[bsl_fix_standards: Анализ файла '${targetPath}']`,
				`Всего обнаружено замечаний: ${violations.length}`,
				`Автоматически ${dryRun ? "сгенерировано исправлений (dry-run)" : "исправлено"}: ${appliedCount}`,
				`Требует ручного исправления разработчиком: ${remainingViolations.length}`,
			];

			if (appliedCount > 0 && diff) {
				lines.push("\nСформированный патч:");
				lines.push("```diff");
				lines.push(diff);
				lines.push("```");
			}

			if (remainingViolations.length > 0) {
				lines.push("\nОставшиеся замечания, требующие внимания:");
				for (const rem of remainingViolations) {
					lines.push(
						`- [Строка ${rem.line}, Кол ${rem.column}] ${rem.severity.toUpperCase()} (${rem.ruleId}): ${rem.message}`,
					);
				}
			}

			const resultDetails: StandardFixResult = {
				filePath: targetPath,
				totalViolations: violations.length,
				appliedFixes: appliedCount,
				remainingViolations,
				diff,
			};

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: resultDetails,
			};
		},
	});
}
