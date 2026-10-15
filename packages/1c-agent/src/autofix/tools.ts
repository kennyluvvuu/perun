import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveBslAnalyzerPath } from "../toolchain/resolver.ts";
import type { BslRuleViolation, StandardFixResult } from "../types.ts";
import { generatePatches, generateUnifiedDiff } from "./patcher.ts";
import { analyzeCodeForItsRules, matchesRuleId, parseBslAnalyzerJsonOutput } from "./rules.ts";

const execAsync = promisify(exec);

const EXCLUDED_DIRS = new Set([".git", "node_modules", "build", "bin", "dist", ".idea", ".vscode"]);

async function collectTargetFiles(dirPath: string): Promise<string[]> {
	const files: string[] = [];

	async function walk(currentDir: string): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.isDirectory()) {
				if (!EXCLUDED_DIRS.has(entry.name)) {
					await walk(path.join(currentDir, entry.name));
				}
			} else if (entry.isFile()) {
				const lower = entry.name.toLowerCase();
				if (lower.endsWith(".bsl") || lower.endsWith(".os") || lower === "template.xml") {
					files.push(path.join(currentDir, entry.name));
				}
			}
		}
	}

	await walk(dirPath);
	return files.sort();
}

interface FileProcessResult {
	filePath: string;
	violations: BslRuleViolation[];
	appliedCount: number;
	diff?: string;
	remainingViolations: BslRuleViolation[];
}

async function processFile(
	filePath: string,
	dryRun: boolean,
	useCli: boolean,
	analyzerBin: string,
	ruleIds?: string[],
): Promise<FileProcessResult | { error: string }> {
	let sourceCode = "";
	try {
		sourceCode = await fs.promises.readFile(filePath, "utf8");
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		return { error: `Ошибка открытия файла '${filePath}': ${msg}` };
	}

	// 1. Run internal ITS rules analysis
	let violations = [...analyzeCodeForItsRules(filePath, sourceCode)];

	// 2. Try running external bsl-analyzer analyze --format json if requested
	const isXml = filePath.toLowerCase().endsWith(".xml");
	if (useCli && !isXml) {
		try {
			const { stdout } = await execAsync(`"${analyzerBin}" analyze --format json "${filePath}"`, {
				timeout: 3000,
			});
			if (stdout.trim()) {
				const externalViolations = parseBslAnalyzerJsonOutput(stdout, filePath);
				// Merge non-duplicate rule violations
				for (const ext of externalViolations) {
					if (!violations.some((v) => v.line === ext.line && matchesRuleId(v.ruleId, ext.ruleId))) {
						violations.push(ext);
					}
				}
			}
		} catch {
			// CLI bsl-analyzer not available or exited with code - use internal rules
		}
	}

	// Filter by ruleIds if specified
	if (ruleIds && ruleIds.length > 0) {
		violations = violations.filter((v) => ruleIds.some((targetRule) => matchesRuleId(v.ruleId, targetRule)));
	}

	if (violations.length === 0) {
		return {
			filePath,
			violations: [],
			appliedCount: 0,
			remainingViolations: [],
		};
	}

	// 3. Generate patches
	const { fixedContent, appliedCount } = generatePatches(filePath, sourceCode, violations);
	const diff = generateUnifiedDiff(filePath, sourceCode, fixedContent);

	if (!dryRun && appliedCount > 0) {
		await fs.promises.writeFile(filePath, fixedContent, "utf8");
	}

	const remainingViolations = violations.filter((v) => !v.canAutoFix);

	return {
		filePath,
		violations,
		appliedCount,
		diff: appliedCount > 0 && diff ? diff : undefined,
		remainingViolations,
	};
}

export function registerAutofixTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "bsl_fix_standards",
		label: "BSL Standards Auto-Fixer",
		description:
			"Статический анализ кода 1С на соответствие стандартам ИТС и автоматическое применение безопасных diff-патчей (исправление пустых попыток, неиспользуемых переменных, BSLDoc и др.).",
		promptSnippet: "bsl_fix_standards: аудит стандартов 1С:ИТС и авто-исправление замечаний",
		parameters: Type.Object({
			target: Type.String({ description: "Путь к файлу .bsl, .os, Template.xml или каталогу для проверки" }),
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

			let stat: fs.Stats;
			try {
				stat = await fs.promises.stat(targetPath);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				return {
					content: [{ type: "text", text: `Ошибка открытия файла '${targetPath}': ${msg}` }],
					isError: true,
					details: undefined,
				};
			}

			const useCli = params.useCli ?? process.env.BSL_ANALYZER_CLI === "1";
			const analyzerBin = resolveBslAnalyzerPath() || "bsl-analyzer";

			// Directory mode
			if (stat.isDirectory()) {
				const files = await collectTargetFiles(targetPath);
				if (files.length === 0) {
					return {
						content: [
							{
								type: "text",
								text: `[bsl_fix_standards]: В каталоге '${targetPath}' не найдено файлов для проверки (.bsl, .os, Template.xml).`,
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

				let totalViolations = 0;
				let totalAppliedFixes = 0;
				const allRemainingViolations: BslRuleViolation[] = [];
				const diffs: string[] = [];
				const fileSummaries: FileProcessResult[] = [];

				for (const file of files) {
					const res = await processFile(file, dryRun, useCli, analyzerBin, params.ruleIds);
					if ("error" in res) continue;

					if (res.violations.length > 0) {
						totalViolations += res.violations.length;
						totalAppliedFixes += res.appliedCount;
						allRemainingViolations.push(...res.remainingViolations);
						if (res.diff) {
							diffs.push(res.diff);
						}
						fileSummaries.push(res);
					}
				}

				if (totalViolations === 0) {
					return {
						content: [
							{
								type: "text",
								text: `[bsl_fix_standards]: Проверено файлов: ${files.length} в каталоге '${targetPath}'. Нарушений стандартов 1С:ИТС не обнаружено. Код соответствует стандарту.`,
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

				const lines: string[] = [
					`[bsl_fix_standards: Анализ каталога '${targetPath}']`,
					`Проверено файлов: ${files.length}`,
					`Всего обнаружено замечаний: ${totalViolations}`,
					`Автоматически ${dryRun ? "сгенерировано исправлений (dry-run)" : "исправлено"}: ${totalAppliedFixes}`,
					`Требует ручного исправления разработчиком: ${allRemainingViolations.length}`,
				];

				lines.push("\nРезультаты по файлам:");
				for (const summary of fileSummaries) {
					lines.push(`\nФайл: ${summary.filePath}`);
					lines.push(`  Обнаружено замечаний: ${summary.violations.length}, исправлено: ${summary.appliedCount}`);
					if (summary.remainingViolations.length > 0) {
						for (const rem of summary.remainingViolations) {
							lines.push(
								`  - [Строка ${rem.line}, Кол ${rem.column}] ${rem.severity.toUpperCase()} (${rem.ruleId}): ${rem.message}`,
							);
						}
					}
				}

				if (totalAppliedFixes > 0 && diffs.length > 0) {
					lines.push("\nСформированный патч:");
					lines.push("```diff");
					lines.push(diffs.join("\n\n"));
					lines.push("```");
				}

				const combinedDiff = diffs.length > 0 ? diffs.join("\n\n") : undefined;

				const resultDetails: StandardFixResult = {
					filePath: targetPath,
					totalViolations,
					appliedFixes: totalAppliedFixes,
					remainingViolations: allRemainingViolations,
					diff: combinedDiff,
				};

				return {
					content: [{ type: "text", text: lines.join("\n") }],
					details: resultDetails,
				};
			}

			// Single file mode
			const result = await processFile(targetPath, dryRun, useCli, analyzerBin, params.ruleIds);
			if ("error" in result) {
				return {
					content: [{ type: "text", text: result.error }],
					isError: true,
					details: undefined,
				};
			}

			if (result.violations.length === 0) {
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

			const lines: string[] = [
				`[bsl_fix_standards: Анализ файла '${targetPath}']`,
				`Всего обнаружено замечаний: ${result.violations.length}`,
				`Автоматически ${dryRun ? "сгенерировано исправлений (dry-run)" : "исправлено"}: ${result.appliedCount}`,
				`Требует ручного исправления разработчиком: ${result.remainingViolations.length}`,
			];

			if (result.appliedCount > 0 && result.diff) {
				lines.push("\nСформированный патч:");
				lines.push("```diff");
				lines.push(result.diff);
				lines.push("```");
			}

			if (result.remainingViolations.length > 0) {
				lines.push("\nОставшиеся замечания, требующие внимания:");
				for (const rem of result.remainingViolations) {
					lines.push(
						`- [Строка ${rem.line}, Кол ${rem.column}] ${rem.severity.toUpperCase()} (${rem.ruleId}): ${rem.message}`,
					);
				}
			}

			const resultDetails: StandardFixResult = {
				filePath: targetPath,
				totalViolations: result.violations.length,
				appliedFixes: result.appliedCount,
				remainingViolations: result.remainingViolations,
				diff: result.diff,
			};

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				details: resultDetails,
			};
		},
	});
}
