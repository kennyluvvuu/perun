import * as fs from "node:fs";
import * as path from "node:path";
import type { BslLspClient } from "../lsp/client.ts";
import type { BslAstSymbol, BslCallHierarchyResult } from "../types.ts";
import { parseBslSymbols } from "./ast-parser.ts";

export class CallHierarchyNavigator {
	private readonly lspClient?: BslLspClient;

	constructor(lspClient?: BslLspClient) {
		this.lspClient = lspClient;
	}

	public async getCallHierarchy(
		filePath: string,
		symbolName: string,
		projectRoot?: string,
	): Promise<BslCallHierarchyResult> {
		// 1. Try LSP if client is ready and connected
		if (this.lspClient?.isReady()) {
			try {
				const lspResult = await this.queryLspCallHierarchy(filePath, symbolName);
				if (lspResult) {
					return lspResult;
				}
			} catch {
				// Fallback to AST-based resolution
			}
		}

		// 2. AST-based Call Graph resolution
		return this.resolveCallHierarchyFromAst(filePath, symbolName, projectRoot);
	}

	private async queryLspCallHierarchy(filePath: string, symbolName: string): Promise<BslCallHierarchyResult | null> {
		if (!this.lspClient) return null;

		let fileContent = "";
		try {
			fileContent = await fs.promises.readFile(filePath, "utf8");
		} catch {
			return null;
		}

		const symbols = parseBslSymbols(fileContent);
		const targetSymbol = symbols.find((s) => s.name.toLowerCase() === symbolName.toLowerCase());
		if (!targetSymbol) return null;

		const position = {
			line: targetSymbol.startLine - 1,
			character: 4,
		};

		const prepareItems = await this.lspClient.prepareCallHierarchy(filePath, position);
		if (!prepareItems || prepareItems.length === 0) return null;

		const targetItem = prepareItems[0];
		const incoming = await this.lspClient.incomingCalls(targetItem);
		const outgoing = await this.lspClient.outgoingCalls(targetItem);

		return {
			symbol: symbolName,
			filePath,
			incomingCalls: incoming.map((item) => ({
				caller: item.from.name,
				filePath: this.lspClient?.uriToFilePath(item.from.uri) || item.from.uri,
				line: item.from.range.start.line + 1,
			})),
			outgoingCalls: outgoing.map((item) => ({
				callee: item.to.name,
				filePath: this.lspClient?.uriToFilePath(item.to.uri) || item.to.uri,
				line: item.to.range.start.line + 1,
			})),
		};
	}

	public async resolveCallHierarchyFromAst(
		filePath: string,
		symbolName: string,
		projectRoot?: string,
	): Promise<BslCallHierarchyResult> {
		let currentContent = "";
		try {
			currentContent = await fs.promises.readFile(filePath, "utf8");
		} catch {
			return {
				symbol: symbolName,
				filePath,
				incomingCalls: [],
				outgoingCalls: [],
			};
		}

		const currentSymbols = parseBslSymbols(currentContent);
		const targetSymbol = currentSymbols.find((s) => s.name.toLowerCase() === symbolName.toLowerCase());

		const incomingCalls: Array<{
			caller: string;
			filePath: string;
			line: number;
		}> = [];
		const seenIncoming = new Set<string>();

		// Collect local callers
		for (const sym of currentSymbols) {
			if (sym.name.toLowerCase() === symbolName.toLowerCase()) continue;
			if (sym.calls.some((c) => c.toLowerCase() === symbolName.toLowerCase())) {
				const key = `${filePath}:${sym.name}:${sym.startLine}`;
				if (!seenIncoming.has(key)) {
					seenIncoming.add(key);
					incomingCalls.push({
						caller: sym.name,
						filePath,
						line: sym.startLine,
					});
				}
			}
		}

		// If projectRoot is provided, scan other .bsl files in project
		const root = projectRoot || path.dirname(filePath);
		const otherFiles = await this.findBslFiles(root);
		const otherFileSymbolsMap = new Map<string, readonly BslAstSymbol[]>();

		for (const otherFile of otherFiles) {
			if (path.resolve(otherFile) === path.resolve(filePath)) continue;

			try {
				const content = await fs.promises.readFile(otherFile, "utf8");
				const symbols = parseBslSymbols(content);
				otherFileSymbolsMap.set(otherFile, symbols);

				if (content.toLowerCase().includes(symbolName.toLowerCase())) {
					for (const sym of symbols) {
						if (sym.calls.some((c) => c.toLowerCase() === symbolName.toLowerCase())) {
							const key = `${otherFile}:${sym.name}:${sym.startLine}`;
							if (!seenIncoming.has(key)) {
								seenIncoming.add(key);
								incomingCalls.push({
									caller: sym.name,
									filePath: otherFile,
									line: sym.startLine,
								});
							}
						}
					}
				}
			} catch {
				// Ignore read errors for inaccessible files
			}
		}

		const outgoingCalls = targetSymbol
			? targetSymbol.calls.map((callee) => {
					const localTarget = currentSymbols.find((s) => s.name.toLowerCase() === callee.toLowerCase());
					if (localTarget) {
						return {
							callee,
							filePath,
							line: localTarget.startLine,
						};
					}
					// Search in external files for definition
					for (const [otherPath, symbols] of otherFileSymbolsMap) {
						const extTarget = symbols.find((s) => s.name.toLowerCase() === callee.toLowerCase());
						if (extTarget) {
							return {
								callee,
								filePath: otherPath,
								line: extTarget.startLine,
							};
						}
					}
					return {
						callee,
						filePath,
						line: targetSymbol.startLine,
					};
				})
			: [];

		return {
			symbol: symbolName,
			filePath,
			incomingCalls,
			outgoingCalls,
		};
	}

	private async findBslFiles(directory: string): Promise<string[]> {
		const result: string[] = [];
		try {
			const entries = await fs.promises.readdir(directory, { withFileTypes: true });
			for (const entry of entries) {
				const full = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					if (![".git", "node_modules", "dist", ".metadata"].includes(entry.name)) {
						const sub = await this.findBslFiles(full);
						result.push(...sub);
					}
				} else if (entry.isFile() && (entry.name.endsWith(".bsl") || entry.name.endsWith(".os"))) {
					result.push(full);
				}
			}
		} catch {
			// Directory read error
		}
		return result;
	}
}
