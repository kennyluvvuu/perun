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

export const RULE_ALIASES: Record<string, string> = {
	CreateQueryInCycle: "QueryInLoop",
	QueryInLoop: "CreateQueryInCycle",
	MissingCodeTryCatchEx: "EmptyExcept",
	EmptyExcept: "MissingCodeTryCatchEx",
	UnusedLocalVariable: "UnusedVariable",
	UnusedVariable: "UnusedLocalVariable",
	MissingBSLDocComments: "MissingBSLDoc",
	MissingBSLDocMethod: "MissingBSLDoc",
	MissingBSLDoc: "MissingBSLDocMethod",
};

const NORMALIZED_RULES: Record<string, string> = {
	CreateQueryInCycle: "QueryInLoop",
	QueryInLoop: "QueryInLoop",
	MissingCodeTryCatchEx: "EmptyExcept",
	EmptyExcept: "EmptyExcept",
	UnusedLocalVariable: "UnusedVariable",
	UnusedVariable: "UnusedVariable",
	MissingBSLDocComments: "MissingBSLDoc",
	MissingBSLDocMethod: "MissingBSLDoc",
	MissingBSLDoc: "MissingBSLDoc",
	QueryVirtualTableParameterArity: "QueryVirtualTableParameterArity",
};

export function normalizeRuleId(ruleId: string): string {
	return NORMALIZED_RULES[ruleId] ?? ruleId;
}

export function matchesRuleId(candidate: string, target: string): boolean {
	if (candidate === target) return true;
	const normCandidate = normalizeRuleId(candidate);
	const normTarget = normalizeRuleId(target);
	if (normCandidate === normTarget) return true;
	return RULE_ALIASES[candidate] === target || RULE_ALIASES[target] === candidate;
}

const AUTO_FIXABLE_RULES = new Set([
	"EmptyExcept",
	"MissingCodeTryCatchEx",
	"UnusedVariable",
	"UnusedLocalVariable",
	"MissingBSLDoc",
	"MissingBSLDocComments",
	"MissingBSLDocMethod",
]);

export function isRuleAutoFixable(ruleId: string): boolean {
	const normalized = normalizeRuleId(ruleId);
	return AUTO_FIXABLE_RULES.has(ruleId) || AUTO_FIXABLE_RULES.has(normalized);
}

export interface VirtualTableLimit {
	readonly max: number;
	readonly canonicalName: string;
}

export const VIRTUAL_TABLE_PARAM_LIMITS: Record<string, VirtualTableLimit> = {
	остатки: { max: 2, canonicalName: "Остатки" },
	balance: { max: 2, canonicalName: "Balance" },
	обороты: { max: 4, canonicalName: "Обороты" },
	turnovers: { max: 4, canonicalName: "Turnovers" },
	остаткииобороты: { max: 5, canonicalName: "ОстаткиИОбороты" },
	balanceandturnovers: { max: 5, canonicalName: "BalanceAndTurnovers" },
	срезпоследних: { max: 2, canonicalName: "СрезПоследних" },
	slicelast: { max: 2, canonicalName: "SliceLast" },
	срезпервых: { max: 2, canonicalName: "СрезПервых" },
	slicefirst: { max: 2, canonicalName: "SliceFirst" },
	оборотыдткт: { max: 9, canonicalName: "ОборотыДтКт" },
	turnoversdrcr: { max: 9, canonicalName: "TurnoversDrCr" },
	субконто: { max: 5, canonicalName: "Субконто" },
	subconto: { max: 5, canonicalName: "Subconto" },
};

const VT_NAMES_PATTERN =
	"(?:ОстаткиИОбороты|BalanceAndTurnovers|ОборотыДтКт|TurnoversDrCr|СрезПоследних|SliceLast|СрезПервых|SliceFirst|Остатки|Balance|Обороты|Turnovers|Субконто|Subconto)";

const VT_CALL_REGEX = new RegExp(`(?<![А-Яа-яA-Za-z0-9_])(${VT_NAMES_PATTERN})(?![А-Яа-яA-Za-z0-9_])\\s*\\(`, "gi");

export function parseVirtualTableArgs(text: string, openParenIndex: number): { argCount: number; endIndex: number } {
	let depth = 1;
	let inDoubleQuoteString = false;
	let isDoubledQuote = false;
	let inSingleQuoteString = false;
	let inComment = false;
	let inXmlComment = false;
	let commasAtDepth1 = 0;
	let hasNonWhitespaceContent = false;

	let i = openParenIndex + 1;
	const len = text.length;

	while (i < len && depth > 0) {
		const ch = text[i];
		const next = text[i + 1];

		// 1. XML comment handling
		if (inXmlComment) {
			if (ch === "-" && next === "-" && text[i + 2] === ">") {
				inXmlComment = false;
				i += 3;
				continue;
			}
			i++;
			continue;
		}

		// 2. Single-line comment handling
		if (inComment) {
			if (ch === "\n" || ch === "\r") {
				inComment = false;
			}
			i++;
			continue;
		}

		// Check for comment starts if not inside strings
		if (!inDoubleQuoteString && !inSingleQuoteString) {
			if (ch === "<" && next === "!" && text.slice(i, i + 4) === "<!--") {
				inXmlComment = true;
				i += 4;
				continue;
			}
			if (ch === "/" && next === "/") {
				inComment = true;
				i += 2;
				continue;
			}
		}

		// 3. String literal handling
		if (inDoubleQuoteString) {
			if (isDoubledQuote) {
				if (ch === '"' && next === '"') {
					if (text[i + 2] === '"' && text[i + 3] === '"') {
						i += 4;
						continue;
					}
					inDoubleQuoteString = false;
					isDoubledQuote = false;
					i += 2;
					continue;
				}
			} else {
				if (ch === '"') {
					if (next === '"') {
						i += 2;
						continue;
					}
					inDoubleQuoteString = false;
					i++;
					continue;
				}
			}
			i++;
			continue;
		}

		if (inSingleQuoteString) {
			if (ch === "'") {
				if (next === "'") {
					i += 2;
					continue;
				}
				inSingleQuoteString = false;
				i++;
				continue;
			}
			i++;
			continue;
		}

		// String opening outside strings/comments
		if (ch === '"') {
			if (next === '"') {
				inDoubleQuoteString = true;
				isDoubledQuote = true;
				i += 2;
				continue;
			}
			inDoubleQuoteString = true;
			isDoubledQuote = false;
			i++;
			continue;
		}

		if (ch === "'") {
			inSingleQuoteString = true;
			i++;
			continue;
		}

		// 4. Parentheses and argument counting
		if (ch === "(") {
			depth++;
			hasNonWhitespaceContent = true;
			i++;
			continue;
		}

		if (ch === ")") {
			depth--;
			if (depth === 0) {
				i++;
				break;
			}
			i++;
			continue;
		}

		if (ch === "," && depth === 1) {
			commasAtDepth1++;
			i++;
			continue;
		}

		if (ch !== " " && ch !== "\t" && ch !== "\r" && ch !== "\n" && ch !== "|") {
			hasNonWhitespaceContent = true;
		}

		i++;
	}

	let argCount = 0;
	if (commasAtDepth1 > 0) {
		argCount = commasAtDepth1 + 1;
	} else if (hasNonWhitespaceContent) {
		argCount = 1;
	}

	return { argCount, endIndex: i };
}

export function checkVirtualTableArity(
	filePath: string,
	code: string,
	baseOffset = 0,
	fullDocument = code,
): readonly BslRuleViolation[] {
	const violations: BslRuleViolation[] = [];
	const regex = new RegExp(VT_CALL_REGEX.source, VT_CALL_REGEX.flags);

	let match = regex.exec(code);
	while (match !== null) {
		const vtToken = match[1];
		const matchIndex = match.index;
		const openParenIndex = code.indexOf("(", matchIndex + vtToken.length);
		if (openParenIndex === -1) {
			match = regex.exec(code);
			continue;
		}

		// Check if preceded by a procedure/function declaration on the same line
		const lastNewline = code.lastIndexOf("\n", matchIndex);
		const lineStart = lastNewline === -1 ? 0 : lastNewline + 1;
		const linePrefix = code.slice(lineStart, matchIndex);

		if (linePrefix.includes("//")) {
			match = regex.exec(code);
			continue;
		}
		if (/(?:процедура|функция|procedure|function)\s+$/i.test(linePrefix.trim())) {
			match = regex.exec(code);
			continue;
		}

		const limits = VIRTUAL_TABLE_PARAM_LIMITS[vtToken.toLowerCase()];
		if (!limits) {
			match = regex.exec(code);
			continue;
		}

		const { argCount } = parseVirtualTableArgs(code, openParenIndex);

		if (argCount > limits.max) {
			const absIndex = baseOffset + matchIndex;
			const prefix = fullDocument.slice(0, absIndex);
			const line = (prefix.match(/\n/g)?.length ?? 0) + 1;
			const docLastNewline = fullDocument.lastIndexOf("\n", absIndex);
			const column = docLastNewline === -1 ? absIndex + 1 : absIndex - docLastNewline;

			violations.push({
				ruleId: "QueryVirtualTableParameterArity",
				ruleName: "Недопустимое количество параметров виртуальной таблицы",
				message: `Недопустимое количество параметров в виртуальной таблице '${limits.canonicalName}': передано ${argCount}, максимально допустимо ${limits.max}. Платформа 1С отклонит выполнение запроса.`,
				filePath,
				line,
				column,
				severity: "error",
				canAutoFix: false,
			});
		}

		regex.lastIndex = openParenIndex + 1;
		match = regex.exec(code);
	}

	return violations;
}

export function extractQueriesFromXml(xmlContent: string): { queryText: string; startIndex: number }[] {
	const queries: { queryText: string; startIndex: number }[] = [];
	const queryTagRegex = /<query(?:\s[^>]*)?>([\s\S]*?)<\/query>/gi;
	for (const match of xmlContent.matchAll(queryTagRegex)) {
		const fullTag = match[0];
		const innerContent = match[1];
		const innerStartIndex = match.index + fullTag.indexOf(innerContent);
		queries.push({
			queryText: innerContent,
			startIndex: innerStartIndex,
		});
	}
	return queries;
}

export function analyzeCodeForItsRules(filePath: string, sourceCode: string): readonly BslRuleViolation[] {
	if (filePath.toLowerCase().endsWith(".xml")) {
		const xmlQueries = extractQueriesFromXml(sourceCode);
		const violations: BslRuleViolation[] = [];
		for (const q of xmlQueries) {
			violations.push(...checkVirtualTableArity(filePath, q.queryText, q.startIndex, sourceCode));
		}
		violations.sort((a, b) => a.line - b.line || a.column - b.column);
		return violations;
	}

	const violations: BslRuleViolation[] = [...checkVirtualTableArity(filePath, sourceCode)];
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

	violations.sort((a, b) => a.line - b.line || a.column - b.column);
	return violations;
}
