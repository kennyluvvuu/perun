import type { BslPatch, BslRuleViolation } from "../types.ts";

export function generateUnifiedDiff(filePath: string, original: string, modified: string, contextLines = 3): string {
	if (original === modified) return "";

	const origLines = original.split("\n");
	const modLines = modified.split("\n");

	// Find common prefix
	let start = 0;
	while (start < origLines.length && start < modLines.length && origLines[start] === modLines[start]) {
		start++;
	}

	// Find common suffix
	let origEnd = origLines.length - 1;
	let modEnd = modLines.length - 1;
	while (origEnd >= start && modEnd >= start && origLines[origEnd] === modLines[modEnd]) {
		origEnd--;
		modEnd--;
	}

	const contextBeforeStart = Math.max(0, start - contextLines);
	const contextAfterEndOrig = Math.min(origLines.length - 1, origEnd + contextLines);
	const contextAfterEndMod = Math.min(modLines.length - 1, modEnd + contextLines);

	const origHunkStart = contextBeforeStart + 1;
	const origHunkCount = origLines.length === 0 ? 0 : contextAfterEndOrig - contextBeforeStart + 1;
	const modHunkStart = contextBeforeStart + 1;
	const modHunkCount = modLines.length === 0 ? 0 : contextAfterEndMod - contextBeforeStart + 1;

	const diffLines: string[] = [
		`--- a/${filePath}`,
		`+++ b/${filePath}`,
		`@@ -${origHunkStart},${origHunkCount} +${modHunkStart},${modHunkCount} @@`,
	];

	// Leading context
	for (let i = contextBeforeStart; i < start; i++) {
		diffLines.push(` ${origLines[i]}`);
	}

	// Deleted lines
	for (let i = start; i <= origEnd; i++) {
		diffLines.push(`-${origLines[i]}`);
	}

	// Added lines
	for (let i = start; i <= modEnd; i++) {
		diffLines.push(`+${modLines[i]}`);
	}

	// Trailing context
	for (let i = origEnd + 1; i <= contextAfterEndOrig; i++) {
		diffLines.push(` ${origLines[i]}`);
	}

	return diffLines.join("\n");
}

export function generatePatches(
	filePath: string,
	sourceCode: string,
	violations: readonly BslRuleViolation[],
): { patches: readonly BslPatch[]; fixedContent: string; appliedCount: number } {
	let content = sourceCode;
	const patches: BslPatch[] = [];
	let appliedCount = 0;

	// Sort violations descending by line number so edits at bottom don't offset earlier lines
	const sortedViolations = [...violations].sort((a, b) => b.line - a.line);

	for (const v of sortedViolations) {
		if (!v.canAutoFix) continue;

		const lines = content.split("\n");
		const targetIndex = v.line - 1;
		if (targetIndex < 0 || targetIndex >= lines.length) continue;

		if (v.ruleId === "EmptyExcept") {
			// Find except line
			const exceptLine = lines[targetIndex];
			const indentMatch = /^\s*/.exec(exceptLine);
			const indent = indentMatch ? indentMatch[0] : "\t";
			const fixLine = `${indent}\tЗаписьЖурналаРегистрации("Ошибка", УровеньЖурналаРегистрации.Ошибка, , , ОписаниеОшибки());`;

			lines.splice(targetIndex + 1, 0, fixLine);
			const newContent = lines.join("\n");

			patches.push({
				filePath,
				startLine: v.line,
				endLine: v.line + 1,
				originalText: exceptLine,
				replacementText: `${exceptLine}\n${fixLine}`,
				description: "Добавлена запись ошибки в журнал регистрации в пустом блоке Исключение",
			});

			content = newContent;
			appliedCount++;
		} else if (v.ruleId === "UnusedVariable") {
			const line = lines[targetIndex];
			// Match variable name from message: 'Переменная 'X' объявлена...'
			const nameMatch = /'([^']+)'/.exec(v.message);
			const varName = nameMatch ? nameMatch[1] : "";

			if (varName && /^\s*(?:перем|var)\s+/i.test(line)) {
				let updatedLine = "";
				const varDeclMatch = /^\s*(?:перем|var)\s+([^;]+);/i.exec(line);

				if (varDeclMatch) {
					const allVars = varDeclMatch[1].split(",").map((s) => s.trim());
					const remainingVars = allVars.filter((vName) => vName.toLowerCase() !== varName.toLowerCase());

					if (remainingVars.length === 0) {
						lines.splice(targetIndex, 1);
						updatedLine = "";
					} else {
						const indentMatch = /^\s*/.exec(line);
						const indent = indentMatch ? indentMatch[0] : "";
						const isLatin = /^\s*var\b/i.test(line);
						const kw = isLatin ? "Var" : "Перем";
						updatedLine = `${indent}${kw} ${remainingVars.join(", ")};`;
						lines[targetIndex] = updatedLine;
					}
				} else {
					lines.splice(targetIndex, 1);
					updatedLine = "";
				}

				const newContent = lines.join("\n");
				patches.push({
					filePath,
					startLine: v.line,
					endLine: v.line,
					originalText: line,
					replacementText: updatedLine,
					description: `Удалена неиспользуемая переменная '${varName}'`,
				});

				content = newContent;
				appliedCount++;
			}
		} else if (v.ruleId === "MissingBSLDoc") {
			let insertIndex = targetIndex;
			// If preceding non-empty line is a directive (&НаСервере etc.), place doc before the directive
			while (insertIndex > 0 && lines[insertIndex - 1].trim().startsWith("&")) {
				insertIndex--;
			}
			const procLine = lines[targetIndex];
			const nameMatch = /(?:процедура|функция|procedure|function)\s+([А-Яа-яA-Za-z0-9_]+)/i.exec(procLine);
			const routineName = nameMatch ? nameMatch[1] : "Метод";
			const indentMatch = /^\s*/.exec(lines[insertIndex]);
			const indent = indentMatch ? indentMatch[0] : "";

			const bslDocBlock = [
				`${indent}// Описание:`,
				`${indent}//   Выполняет ${routineName}`,
				`${indent}//`,
				`${indent}// Параметры:`,
				`${indent}//   (см. параметры метода)`,
				`${indent}//`,
			].join("\n");

			lines.splice(insertIndex, 0, bslDocBlock);
			const newContent = lines.join("\n");

			patches.push({
				filePath,
				startLine: insertIndex + 1,
				endLine: insertIndex + 1,
				originalText: lines[insertIndex],
				replacementText: `${bslDocBlock}\n${lines[insertIndex]}`,
				description: `Сгенерирован BSLDoc шаблон для экспортного метода '${routineName}'`,
			});

			content = newContent;
			appliedCount++;
		}
	}

	return { patches, fixedContent: content, appliedCount };
}
