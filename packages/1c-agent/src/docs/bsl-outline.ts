// Извлечение структуры модуля BSL для документации: методы, переменные, области, комментарии и хэши.
import { createHash } from "node:crypto";
import { parseBslSymbols } from "../navigator/ast-parser.ts";
import type { BslAstSymbol, BslParameter } from "../types.ts";
import type { DocParameter, ModuleOutline, OutlineSymbol } from "./types.ts";

const REGION_START = /^#\s*(?:область|region)\s+([А-Яа-яЁёA-Za-z0-9_]+)/i;
const REGION_END = /^#\s*(?:конецобласти|endregion)(?![А-Яа-яЁёA-Za-z0-9_])/i;
const VARIABLE_DECLARATION = /^(?:перем|var)\s+(.+?);\s*(?:\/\/\s?(.*))?$/i;
const EXPORT_WORD = /(?<![А-Яа-яЁёA-Za-z0-9_])(?:экспорт|export)(?![А-Яа-яЁёA-Za-z0-9_])/i;
const IDENTIFIER = /^[А-Яа-яЁёA-Za-z_][А-Яа-яЁёA-Za-z0-9_]*/;

function hashText(text: string): string {
	return createHash("sha1").update(text).digest("hex");
}

function normalizedHash(lines: readonly string[]): string {
	return hashText(
		lines
			.map((line) => line.trim().replace(/\s+/g, " "))
			.filter((line) => line.length > 0)
			.join("\n"),
	);
}

function cleanComment(lines: readonly string[]): string | undefined {
	const text = lines
		.map((line) => line.trim().replace(/^\/\/\s?/, ""))
		.join("\n")
		.trim();
	return text.length > 0 ? text : undefined;
}

function formatParameter(parameter: BslParameter): string {
	const prefix = parameter.byValue ? "Знач " : "";
	const suffix = parameter.defaultValue !== undefined ? ` = ${parameter.defaultValue}` : "";
	return `${prefix}${parameter.name}${suffix}`;
}

function toDocParameters(parameters: readonly BslParameter[]): DocParameter[] {
	return parameters.map((parameter) => ({
		name: parameter.name,
		byValue: parameter.byValue,
		...(parameter.defaultValue !== undefined ? { defaultValue: parameter.defaultValue } : {}),
	}));
}

function regionMap(lines: readonly string[]): (string | undefined)[] {
	const stack: string[] = [];
	return lines.map((line) => {
		const trimmed = line.trim();
		const start = REGION_START.exec(trimmed);
		if (start) {
			stack.push(start[1]);
		} else if (REGION_END.test(trimmed)) {
			stack.pop();
		}
		return stack[stack.length - 1];
	});
}

function methodSymbol(symbol: BslAstSymbol, lines: readonly string[], regions: (string | undefined)[]): OutlineSymbol {
	const keyword = symbol.type === "function" ? "Функция" : "Процедура";
	const exportSuffix = symbol.isExport ? " Экспорт" : "";
	const params = symbol.parameters.map(formatParameter).join(", ");
	return {
		name: symbol.name,
		kind: symbol.type === "function" ? "function" : "procedure",
		isExport: symbol.isExport,
		directive: symbol.directive,
		region: regions[symbol.startLine - 1],
		signature: `${keyword} ${symbol.name}(${params})${exportSuffix}`,
		parameters: toDocParameters(symbol.parameters),
		comment: cleanComment(precedingComment(lines, declarationStart(lines, symbol.startLine - 1))),
		calls: symbol.calls,
		line: symbol.startLine,
		endLine: symbol.endLine,
		hash: normalizedHash(lines.slice(symbol.startLine - 1, symbol.endLine)),
	};
}

function precedingComment(lines: readonly string[], index: number): string[] {
	const collected: string[] = [];
	for (let cursor = index - 1; cursor >= 0 && lines[cursor].trim().startsWith("//"); cursor--) {
		collected.unshift(lines[cursor]);
	}
	return collected;
}

function declarationStart(lines: readonly string[], index: number): number {
	let cursor = index;
	while (cursor > 0 && lines[cursor - 1].trim().startsWith("&")) {
		cursor--;
	}
	return cursor;
}

function variableSymbols(
	lines: readonly string[],
	regions: (string | undefined)[],
	insideMethod: (line: number) => boolean,
): OutlineSymbol[] {
	const result: OutlineSymbol[] = [];
	lines.forEach((line, index) => {
		const match = VARIABLE_DECLARATION.exec(line.trim());
		if (!match || insideMethod(index + 1)) {
			return;
		}
		const trailing = match[2] ? [match[2]] : [];
		const comment = cleanComment([...precedingComment(lines, index), ...trailing]);
		for (const part of match[1].split(",")) {
			const name = IDENTIFIER.exec(part.trim())?.[0];
			if (!name) {
				continue;
			}
			const isExport = EXPORT_WORD.test(part);
			result.push({
				name,
				kind: "variable",
				isExport,
				region: regions[index],
				signature: `Перем ${name}${isExport ? " Экспорт" : ""};`,
				parameters: [],
				comment,
				calls: [],
				line: index + 1,
				endLine: index + 1,
				hash: normalizedHash([`${name} ${isExport}`]),
			});
		}
	});
	return result;
}

function headerComment(lines: readonly string[]): string | undefined {
	const collected: string[] = [];
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.startsWith("//")) {
			collected.push(trimmed);
		} else if (trimmed.length > 0) {
			break;
		}
	}
	return cleanComment(collected);
}

export function buildModuleOutline(source: string): ModuleOutline {
	// Разбирает текст модуля BSL в структуру для документации.
	const text = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
	const lines = text.split("\n");
	const regions = regionMap(lines);
	const methods = parseBslSymbols(text)
		.filter((symbol) => symbol.type === "procedure" || symbol.type === "function")
		.map((symbol) => methodSymbol(symbol, lines, regions));
	const insideMethod = (line: number) => methods.some((method) => line >= method.line && line <= method.endLine);
	const symbols = [...variableSymbols(lines, regions, insideMethod), ...methods];
	const firstSymbolLine = symbols.reduce((min, symbol) => Math.min(min, symbol.line), lines.length + 1);
	const header = headerComment(lines);
	const ownsHeader =
		header !== undefined && (symbols.length === 0 || precedingComment(lines, firstSymbolLine - 1).length === 0);
	return {
		comment: ownsHeader ? header : undefined,
		hash: hashText(symbols.map((symbol) => symbol.signature).join("\n")),
		lineCount: lines.length,
		symbols,
	};
}
