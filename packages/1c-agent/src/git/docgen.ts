import * as fs from "node:fs/promises";
import * as path from "node:path";
import { generateUnifiedDiff } from "../autofix/patcher.ts";
import { parseBslSymbols } from "../navigator/ast-parser.ts";
import { generateBslDoc, injectBslDocIntoModule, isBslDocComplete } from "./bsldoc.ts";
import { getChangedFiles } from "./git-runner.ts";
import type { DocGenResult, FileDocSummary, MethodDocUpdate } from "./types.ts";

export async function generateDocsForDiff(
	targetRef?: string,
	filePathFilter?: string,
	projectRoot?: string,
	applyChanges?: boolean,
): Promise<DocGenResult> {
	const cwd = projectRoot || process.cwd();
	const effectiveRef = targetRef?.trim() || "HEAD";

	const changedFiles = await getChangedFiles(effectiveRef, cwd);

	const bslChanges = changedFiles.filter((change) => {
		if (!change.path.toLowerCase().endsWith(".bsl")) {
			return false;
		}
		if (change.status === "D") {
			return false;
		}
		if (filePathFilter && !change.path.includes(filePathFilter)) {
			return false;
		}
		return true;
	});

	if (bslChanges.length === 0) {
		return {
			targetRef: effectiveRef,
			files: [],
			totalFiles: 0,
			totalMethods: 0,
			updatedMethods: 0,
			summary: "No changed .bsl files found matching criteria.",
		};
	}

	const fileSummaries: FileDocSummary[] = [];
	let totalAllMethods = 0;
	let totalUpdatedMethods = 0;

	for (const change of bslChanges) {
		const fullPath = path.isAbsolute(change.path) ? change.path : path.resolve(cwd, change.path);

		let sourceCode = "";
		try {
			sourceCode = await fs.readFile(fullPath, "utf-8");
		} catch {
			continue;
		}

		const symbols = parseBslSymbols(sourceCode);
		const methodSymbols = symbols.filter((s) => s.type === "procedure" || s.type === "function");

		const methodUpdates: MethodDocUpdate[] = [];
		let documentedCount = 0;

		for (const symbol of methodSymbols) {
			const hasDoc = isBslDocComplete(symbol.bslDoc, symbol.parameters);
			const generatedDoc = generateBslDoc(symbol);

			if (hasDoc) {
				documentedCount++;
			}

			methodUpdates.push({
				methodName: symbol.name,
				methodType: symbol.type as "procedure" | "function",
				startLine: symbol.startLine,
				existingDoc: symbol.bslDoc,
				generatedDoc,
				hasDoc,
				isExport: symbol.isExport,
			});
		}

		const undocumentedSymbols = methodSymbols
			.filter((s) => !isBslDocComplete(s.bslDoc, s.parameters))
			.sort((a, b) => b.startLine - a.startLine);

		let updatedSource = sourceCode;
		for (const symbol of undocumentedSymbols) {
			const docToInject = generateBslDoc(symbol);
			updatedSource = injectBslDocIntoModule(updatedSource, symbol, docToInject);
		}

		const needsUpdate = updatedSource !== sourceCode;
		const updatedInThisFile = undocumentedSymbols.length;

		let patch: string | undefined;
		if (applyChanges) {
			if (needsUpdate) {
				await fs.writeFile(fullPath, updatedSource, "utf-8");
			}
		} else if (needsUpdate) {
			patch = generateUnifiedDiff(change.path, sourceCode, updatedSource);
		}

		fileSummaries.push({
			filePath: change.path,
			methods: methodUpdates,
			totalMethods: methodSymbols.length,
			documentedMethods: documentedCount,
			patch,
		});

		totalAllMethods += methodSymbols.length;
		totalUpdatedMethods += updatedInThisFile;
	}

	const summary = `DocGen completed for ${fileSummaries.length} file(s): ${totalAllMethods} total method(s), ${totalUpdatedMethods} updated/documented.`;

	return {
		targetRef: effectiveRef,
		files: fileSummaries,
		totalFiles: fileSummaries.length,
		totalMethods: totalAllMethods,
		updatedMethods: totalUpdatedMethods,
		summary,
	};
}
