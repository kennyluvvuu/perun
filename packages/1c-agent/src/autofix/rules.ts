import type { BslRuleViolation } from "../types.ts";

export interface BslAnalyzerJsonDiagnostic {
	file?: string;
	line?: number;
	column?: number;
	end_line?: number;
	end_column?: number;
	severity?: string;
	code?: string;
	message?: string;
}

export function parseBslAnalyzerJsonOutput(jsonString: string, defaultFilePath: string): readonly BslRuleViolation[] {
	try {
		const parsed = JSON.parse(jsonString);
		const items: BslAnalyzerJsonDiagnostic[] = Array.isArray(parsed) ? parsed : parsed.diagnostics || [];

		return items.map((item) => ({
			ruleId: item.code || "V8STD",
			ruleName: item.code || "Стандарт разработки 1С",
			message: item.message || "Нарушение стандарта",
			filePath: item.file || defaultFilePath,
			line: item.line ?? 1,
			column: item.column ?? 1,
			endLine: item.end_line,
			endColumn: item.end_column,
			severity: item.severity?.toLowerCase() === "error" ? "error" : "warning",
			canAutoFix: isRuleAutoFixable(item.code || ""),
		}));
	} catch {
		return [];
	}
}

export function isRuleAutoFixable(ruleId: string): boolean {
	const autoFixableRules = new Set(["EmptyExcept", "UnusedVariable", "MissingBSLDoc"]);
	return autoFixableRules.has(ruleId);
}

export function analyzeCodeForItsRules(filePath: string, sourceCode: string): readonly BslRuleViolation[] {
	const violations: BslRuleViolation[] = [];
	const lines = sourceCode.split("\n");

	let inLoop = false;
	let loopStartLine = 0;
	let loopDepth = 0;

	let inExceptBlock = false;
	let exceptStartLine = 0;
	let exceptStatementsCount = 0;

	let currentDirective: string | undefined;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();
		const lineNum = i + 1;

		if (trimmed.startsWith("&")) {
			currentDirective = trimmed.toLowerCase();
		}

		// 1. Query in Loop check
		if (/^\s*(?:для|пока|for|while)(?![А-Яа-яA-Za-z0-9_])/i.test(trimmed)) {
			inLoop = true;
			loopDepth++;
			if (loopDepth === 1) loopStartLine = lineNum;
		}

		if (/^\s*(?:конеццикла|enddo)(?:;|\s|$)/i.test(trimmed)) {
			loopDepth = Math.max(0, loopDepth - 1);
			if (loopDepth === 0) inLoop = false;
		}

		if (inLoop && /(?:\.выполнить\(|\.execute\()/i.test(trimmed)) {
			violations.push({
				ruleId: "QueryInLoop",
				ruleName: "Запрос в цикле",
				message: `Вызов метода 'Выполнить()' запроса внутри цикла (начало цикла на строке ${loopStartLine}). Нарушение стандарта ИТС: запросы необходимо выполнять пакетно до входа в цикл.`,
				filePath,
				line: lineNum,
				column: line.indexOf(trimmed) + 1,
				severity: "error",
				canAutoFix: false,
			});
		}

		// 2. Empty Try-Except block
		if (/^\s*(?:попытка|try)(?:;|\s|$)/i.test(trimmed)) {
			inExceptBlock = false;
		}

		if (/^\s*(?:исключение|except)(?:;|\s|$)/i.test(trimmed)) {
			inExceptBlock = true;
			exceptStartLine = lineNum;
			exceptStatementsCount = 0;
		}

		if (inExceptBlock && !/^\s*(?:исключение|except|конецпопытки|endtry)(?:;|\s|$)/i.test(trimmed)) {
			if (trimmed && !trimmed.startsWith("//")) {
				exceptStatementsCount++;
			}
		}

		if (/^\s*(?:конецпопытки|endtry)(?:;|\s|$)/i.test(trimmed)) {
			if (inExceptBlock && exceptStatementsCount === 0) {
				violations.push({
					ruleId: "EmptyExcept",
					ruleName: "Пустой блок Исключение",
					message:
						"Пустая секция 'Исключение' без обработки или логирования ошибки скрывает аварийные ситуации. Добавьте запись в журнал регистрации или повторный вызов исключения.",
					filePath,
					line: exceptStartLine,
					column: 1,
					endLine: lineNum,
					severity: "warning",
					canAutoFix: true,
					suggestedFix:
						'\t\tЗаписьЖурналаРегистрации("Ошибка", УровеньЖурналаРегистрации.Ошибка, , , ОписаниеОшибки());',
				});
			}
			inExceptBlock = false;
			exceptStatementsCount = 0;
		}

		// 3. Unused local variable declared via 'Перем'
		if (/^\s*(?:перем|var)\s+([А-Яа-яA-Za-z0-9_,\s]+);/i.test(trimmed)) {
			const varMatch = /^\s*(?:перем|var)\s+([^;]+);/i.exec(trimmed);
			if (varMatch) {
				const varNames = varMatch[1]
					.split(",")
					.map((v) => v.trim())
					.filter((v) => !v.toLowerCase().includes("экспорт"));
				for (const varName of varNames) {
					// Check if var is used anywhere else in the code (accounting for Cyrillic identifier boundaries)
					const escapedVar = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
					const varRegex = new RegExp(`(?<![А-Яа-яA-Za-z0-9_])${escapedVar}(?![А-Яа-яA-Za-z0-9_])`, "gi");
					const matches = sourceCode.match(varRegex) || [];
					if (matches.length <= 1) {
						violations.push({
							ruleId: "UnusedVariable",
							ruleName: "Неиспользуемая переменная",
							message: `Переменная '${varName}' объявлена, но не используется в модуле.`,
							filePath,
							line: lineNum,
							column: line.indexOf(varName) + 1,
							severity: "warning",
							canAutoFix: true,
						});
					}
				}
			}
		}

		// 4. Deprecated modal calls in server context (Сообщить is valid on server; modal dialogs are forbidden)
		if (
			currentDirective?.includes("насервере") &&
			/(?<![А-Яа-яA-Za-z0-9_])(предупреждение|вопрос|ввестичисло|ввестистроку|ввестидату|ввестизначение)\s*\(/i.test(
				trimmed,
			)
		) {
			const funcMatch =
				/(?<![А-Яа-яA-Za-z0-9_])(предупреждение|вопрос|ввестичисло|ввестистроку|ввестидату|ввестизначение)(?![А-Яа-яA-Za-z0-9_])/i.exec(
					trimmed,
				);
			violations.push({
				ruleId: "ServerModalCall",
				ruleName: "Модальный вызов на сервере",
				message: `Вызов интерактивной модальной функции '${funcMatch?.[1]}' в серверном контексте (${currentDirective}) недопустим по стандартам ИТС.`,
				filePath,
				line: lineNum,
				column: line.indexOf(trimmed) + 1,
				severity: "error",
				canAutoFix: false,
			});
		}

		// 5. Missing BSLDoc before Export Procedure/Function
		if (
			/^\s*(?:процедура|функция|procedure|function)\s+[А-Яа-яA-Za-z0-9_]+\s*\([^)]*\)\s*(?:экспорт|export)/i.test(
				trimmed,
			)
		) {
			// Check if previous non-empty line was a comment
			let hasDoc = false;
			for (let k = i - 1; k >= 0; k--) {
				const prev = lines[k].trim();
				if (!prev) continue;
				if (prev.startsWith("&")) continue; // Skip directive
				if (prev.startsWith("//")) {
					hasDoc = true;
				}
				break;
			}

			if (!hasDoc) {
				violations.push({
					ruleId: "MissingBSLDoc",
					ruleName: "Отсутствует BSLDoc комментарий",
					message: `Экспортный метод на строке ${lineNum} не снабжен стандартным описанием параметров и назначения по стандарту ИТС.`,
					filePath,
					line: lineNum,
					column: 1,
					severity: "info",
					canAutoFix: true,
				});
			}
		}
	}

	return violations;
}
