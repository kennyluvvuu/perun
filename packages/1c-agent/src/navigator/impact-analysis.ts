import * as fs from "node:fs";
import * as path from "node:path";
import type { BslImpactReference, BslImpactReport } from "../types.ts";
import { parseBslSymbols } from "./ast-parser.ts";

export class ImpactAnalyzer {
	private readonly projectRoot: string;

	constructor(projectRoot: string = process.cwd()) {
		this.projectRoot = projectRoot;
	}

	public async analyzeImpact(target: string, customRoot?: string): Promise<BslImpactReport> {
		const root = customRoot || this.projectRoot;
		const files = await this.collectFiles(root);
		const references: BslImpactReference[] = [];
		const affectedRegisters = new Set<string>();
		let affectsPosting = false;

		const lowerTarget = target.toLowerCase();

		for (const file of files) {
			let content = "";
			try {
				content = await fs.promises.readFile(file, "utf8");
			} catch {
				continue;
			}

			if (!content.toLowerCase().includes(lowerTarget)) {
				continue;
			}

			const isBsl = file.endsWith(".bsl") || file.endsWith(".os");
			if (isBsl) {
				const symbols = parseBslSymbols(content);
				const lines = content.split("\n");

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (!line.toLowerCase().includes(lowerTarget)) continue;

					// Determine context
					const currentSymbol = symbols.find((s) => s.startLine <= i + 1 && s.endLine >= i + 1);
					const isPostingMethod =
						currentSymbol && /^(?:обработкапроведения|posting|передзаписью|призаписи)/i.test(currentSymbol.name);

					let contextType: BslImpactReference["contextType"] = "other";

					if (line.toLowerCase().includes("движения.")) {
						contextType = "register";
						const regMatch = /движения\.([А-Яа-яA-Za-z0-9_]+)/i.exec(line);
						if (regMatch) {
							affectedRegisters.add(regMatch[1]);
						}
					} else if (line.toLowerCase().includes("выбрать") || line.trim().startsWith("|")) {
						contextType = "query";
					} else if (isPostingMethod) {
						contextType = "posting";
					} else if (currentSymbol) {
						contextType = "module";
					}

					if (isPostingMethod) {
						affectsPosting = true;
					}

					references.push({
						filePath: file,
						line: i + 1,
						snippet: line.trim(),
						contextType,
					});
				}
			} else if (file.endsWith(".mdo")) {
				// EDT metadata XML
				const lines = content.split("\n");
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (line.toLowerCase().includes(lowerTarget)) {
						references.push({
							filePath: file,
							line: i + 1,
							snippet: line.trim(),
							contextType: "other",
						});
					}
				}
			}
		}

		// Check if any register name matched directly
		const regList = [...affectedRegisters];
		const summary = this.buildSummary(target, references.length, regList, affectsPosting);

		return {
			target,
			directReferencesCount: references.length,
			references,
			affectedRegisters: regList,
			affectsPosting,
			summary,
		};
	}

	private buildSummary(target: string, count: number, registers: readonly string[], affectsPosting: boolean): string {
		if (count === 0) {
			return `Вхождений '${target}' в кодовой базе не найдено. Изменение не затронет существующие алгоритмы.`;
		}

		const parts: string[] = [`Обнаружено ${count} вхождений '${target}'.`];

		if (affectsPosting) {
			parts.push("ВНИМАНИЕ: Изменение затрагивает алгоритмы проведения документов (ОбработкаПроведения)!");
		}

		if (registers.length > 0) {
			parts.push(`Затронуты регистры накопления/сведений: ${registers.join(", ")}.`);
		}

		return parts.join(" ");
	}

	private async collectFiles(directory: string): Promise<string[]> {
		const files: string[] = [];
		try {
			const entries = await fs.promises.readdir(directory, { withFileTypes: true });
			for (const entry of entries) {
				const full = path.join(directory, entry.name);
				if (entry.isDirectory()) {
					if (![".git", "node_modules", "dist", ".metadata", ".idea"].includes(entry.name)) {
						const sub = await this.collectFiles(full);
						files.push(...sub);
					}
				} else if (
					entry.isFile() &&
					(entry.name.endsWith(".bsl") || entry.name.endsWith(".os") || entry.name.endsWith(".mdo"))
				) {
					files.push(full);
				}
			}
		} catch {
			// Directory read error
		}
		return files;
	}
}
