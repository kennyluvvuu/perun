import type { BslAstSymbol, BslParameter, BslQueryInfo, BslSymbolType } from "../types.ts";

const BSL_KEYWORDS = new Set<string>([
	"если",
	"тогда",
	"иначе",
	"иначеесли",
	"конецесли",
	"для",
	"каждого",
	"из",
	"по",
	"цикл",
	"конеццикла",
	"пока",
	"попытка",
	"исключение",
	"конецпопытки",
	"возврат",
	"продолжить",
	"прервать",
	"новый",
	"вызватьисключение",
	"выполнить",
	"перейти",
	"и",
	"или",
	"не",
	"истина",
	"ложь",
	"неопределено",
	"null",
	"if",
	"then",
	"else",
	"elsif",
	"endif",
	"for",
	"each",
	"in",
	"to",
	"do",
	"enddo",
	"while",
	"try",
	"except",
	"endtry",
	"return",
	"continue",
	"break",
	"new",
	"raise",
	"execute",
	"goto",
	"and",
	"or",
	"not",
	"true",
	"false",
	"undefined",
]);

export function parseBslParameters(rawParams: string): readonly BslParameter[] {
	if (!rawParams.trim()) return [];

	const result: BslParameter[] = [];
	const parts = rawParams.split(",");

	for (const part of parts) {
		const trimmed = part.trim();
		if (!trimmed) continue;

		let byValue = false;
		let clean = trimmed;

		const lower = trimmed.toLowerCase();
		if (lower.startsWith("знач ") || lower.startsWith("val ")) {
			byValue = true;
			clean = trimmed.slice(trimmed.indexOf(" ") + 1).trim();
		}

		let name = clean;
		let defaultValue: string | undefined;

		const eqIndex = clean.indexOf("=");
		if (eqIndex !== -1) {
			name = clean.slice(0, eqIndex).trim();
			defaultValue = clean.slice(eqIndex + 1).trim();
		}

		result.push({
			name,
			defaultValue,
			byValue,
		});
	}

	return result;
}

export function extractTablesFromQuery(queryText: string): readonly string[] {
	const tables = new Set<string>();
	const cleanText = queryText.replace(/(^|\n)\s*\|\s*/g, "$1 ");
	const regex =
		/(?<![А-Яа-яA-Za-z0-9_])(?:ИЗ|FROM|СОЕДИНЕНИЕ|JOIN)\s+(?:["']\s*\+\s*([А-Яа-яA-Za-z0-9_]+)|([А-Яа-яA-Za-z0-9_]+(?:\.[А-Яа-яA-Za-z0-9_]+)*))/gi;

	let match: RegExpExecArray | null = regex.exec(cleanText);
	while (match !== null) {
		const rawTableName = match[1] || match[2] || "";
		const tableName = rawTableName.trim();
		if (
			tableName &&
			!["(", ")", "как", "as", "где", "where", "select", "выбрать"].includes(tableName.toLowerCase())
		) {
			tables.add(tableName);
		}
		match = regex.exec(cleanText);
	}

	return [...tables];
}

export function extractQueries(code: string): readonly BslQueryInfo[] {
	const queries: BslQueryInfo[] = [];
	const lines = code.split("\n");

	let inQuery = false;
	let queryLines: string[] = [];
	let startLine = 0;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Check for query initiation: Запрос.Текст, ТекстЗапроса, or "ВЫБРАТЬ"
		if (!inQuery) {
			if (
				trimmed.toLowerCase().includes("запрос.текст") ||
				trimmed.toLowerCase().includes("текстзапроса") ||
				/(?:^|[=(,])\s*["|]?\s*(?:выбрать|select)(?![А-Яа-яA-Za-z0-9_])/i.test(trimmed)
			) {
				if (trimmed.endsWith('";')) {
					queries.push({
						queryText: trimmed,
						startLine: i + 1,
						endLine: i + 1,
						tables: extractTablesFromQuery(trimmed),
					});
				} else {
					inQuery = true;
					startLine = i + 1;
					queryLines = [trimmed];
				}
			}
		} else {
			if (trimmed.startsWith("|") || trimmed.startsWith('"') || trimmed.startsWith("+") || trimmed.endsWith('";')) {
				queryLines.push(trimmed);
				if (trimmed.endsWith('";')) {
					const fullText = queryLines.join("\n");
					queries.push({
						queryText: fullText,
						startLine,
						endLine: i + 1,
						tables: extractTablesFromQuery(fullText),
					});
					inQuery = false;
					queryLines = [];
				}
			} else {
				if (queryLines.length > 0) {
					const fullText = queryLines.join("\n");
					queries.push({
						queryText: fullText,
						startLine,
						endLine: i,
						tables: extractTablesFromQuery(fullText),
					});
				}
				inQuery = false;
				queryLines = [];
			}
		}
	}

	if (inQuery && queryLines.length > 0) {
		const fullText = queryLines.join("\n");
		queries.push({
			queryText: fullText,
			startLine,
			endLine: lines.length,
			tables: extractTablesFromQuery(fullText),
		});
	}

	return queries;
}

export function extractCalls(bodyText: string): readonly string[] {
	const calls = new Set<string>();
	const callRegex = /(?<![А-Яа-яA-Za-z0-9_])([А-Яа-яA-Za-z0-9_]+)\s*\(/g;

	let match: RegExpExecArray | null = callRegex.exec(bodyText);
	while (match !== null) {
		const identifier = match[1];
		if (!BSL_KEYWORDS.has(identifier.toLowerCase())) {
			calls.add(identifier);
		}
		match = callRegex.exec(bodyText);
	}

	return [...calls];
}

export function parseBslSymbols(sourceCode: string): readonly BslAstSymbol[] {
	const symbols: BslAstSymbol[] = [];
	const lines = sourceCode.split("\n");

	let currentDirective: string | undefined;
	let currentBslDocLines: string[] = [];
	let inRoutine = false;
	let currentSymbol: {
		name: string;
		type: BslSymbolType;
		isExport: boolean;
		directive?: string;
		startLine: number;
		parameters: readonly BslParameter[];
		bslDoc?: string;
	} | null = null;
	let routineBodyLines: string[] = [];

	const procHeaderStartRegex = /^\s*(?:(процедура|функция|procedure|function))\s+([А-Яа-яA-Za-z0-9_]+)\s*\(/i;
	const endProcFuncRegex = /^\s*(?:конецпроцедуры|конецфункции|endprocedure|endfunction)(?:;|\s|$)/i;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const trimmed = line.trim();

		// Directives like &НаСервере, &НаКлиенте
		if (trimmed.startsWith("&")) {
			currentDirective = trimmed;
			continue;
		}

		// Comment lines preceding procedures/functions
		if (trimmed.startsWith("//")) {
			if (!inRoutine) {
				currentBslDocLines.push(trimmed);
			}
			continue;
		}

		// Preprocessor directives like #Если, #Область, #КонецОбласти do not clear doc comments
		if (trimmed.startsWith("#")) {
			continue;
		}

		// Routine header (supports single-line and multi-line declarations)
		if (!inRoutine) {
			const startMatch = procHeaderStartRegex.exec(trimmed);
			if (startMatch) {
				const keyword = startMatch[1].toLowerCase();
				const name = startMatch[2];
				const type: BslSymbolType = keyword === "процедура" || keyword === "procedure" ? "procedure" : "function";
				const routineStartLine = i + 1;

				// Accumulate header until closing parenthesis
				let headerText = trimmed.slice(trimmed.indexOf("(") + 1);
				let foundClosingParen = headerText.includes(")");

				while (!foundClosingParen && i + 1 < lines.length) {
					i++;
					const nextLine = lines[i].trim();
					headerText += `\n${nextLine}`;
					if (nextLine.includes(")")) {
						foundClosingParen = true;
					}
				}

				const closingIndex = headerText.lastIndexOf(")");
				const rawParams = closingIndex !== -1 ? headerText.slice(0, closingIndex) : headerText;
				const afterClosing = closingIndex !== -1 ? headerText.slice(closingIndex + 1) : "";
				const isExport = /(?<![А-Яа-яA-Za-z0-9_])(экспорт|export)(?![А-Яа-яA-Za-z0-9_])/i.test(afterClosing);

				inRoutine = true;
				currentSymbol = {
					name,
					type,
					isExport,
					directive: currentDirective,
					startLine: routineStartLine,
					parameters: parseBslParameters(rawParams),
					bslDoc: currentBslDocLines.length > 0 ? currentBslDocLines.join("\n") : undefined,
				};
				currentDirective = undefined;
				currentBslDocLines = [];
				routineBodyLines = [];
				continue;
			}
		}

		// Inside routine
		if (inRoutine && currentSymbol) {
			if (endProcFuncRegex.test(trimmed)) {
				const bodyText = routineBodyLines.join("\n");
				const calls = extractCalls(bodyText);
				const queries = extractQueries(bodyText);

				symbols.push({
					name: currentSymbol.name,
					type: currentSymbol.type,
					isExport: currentSymbol.isExport,
					directive: currentSymbol.directive,
					startLine: currentSymbol.startLine,
					endLine: i + 1,
					parameters: currentSymbol.parameters,
					calls,
					queries,
					bslDoc: currentSymbol.bslDoc,
				});

				inRoutine = false;
				currentSymbol = null;
				routineBodyLines = [];
			} else {
				routineBodyLines.push(line);
			}
			continue;
		}

		// Reset preceding comments if ordinary code encountered outside routine
		if (trimmed && !inRoutine) {
			currentBslDocLines = [];
			currentDirective = undefined;
		}
	}

	return symbols;
}
