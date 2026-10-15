import * as fs from "node:fs";
import * as path from "node:path";
import { extractTaskRefs, getCommitInfo, runGitBlame, runGitLogForFile, runGitLogForSymbol } from "./git-runner.ts";
import type { GitBlameContextResult, GitBlameLine, GitCommitInfo } from "./types.ts";

function groupIntoRanges(lineNumbers: number[]): Array<{ start: number; end: number }> {
	if (lineNumbers.length === 0) {
		return [];
	}
	const sorted = Array.from(new Set(lineNumbers)).sort((a, b) => a - b);
	const ranges: Array<{ start: number; end: number }> = [];
	let start = sorted[0];
	let end = sorted[0];

	for (let i = 1; i < sorted.length; i++) {
		if (sorted[i] <= end + 2) {
			end = sorted[i];
		} else {
			ranges.push({ start, end });
			start = sorted[i];
			end = sorted[i];
		}
	}
	ranges.push({ start, end });
	return ranges;
}

function buildLineSummary(
	filePath: string,
	lineNumber: number,
	blameLine: GitBlameLine | undefined,
	commit: GitCommitInfo | null,
): string {
	const fileName = path.basename(filePath);
	if (!blameLine) {
		return `Строка ${lineNumber} в файле '${fileName}': информация об авторе не найдена в git.`;
	}

	const author = blameLine.author || commit?.author || "Неизвестный автор";
	const date = blameLine.date ? blameLine.date.split("T")[0] : commit?.date ? commit.date.split("T")[0] : "неизвестно";
	const hash = blameLine.commitHash.slice(0, 8);
	const message = commit?.message || blameLine.summary || "Без описания";
	const taskRefs = commit?.taskRefs && commit.taskRefs.length > 0 ? commit.taskRefs : extractTaskRefs(message);
	const taskStr = taskRefs.length > 0 ? ` [задачи: ${taskRefs.join(", ")}]` : "";
	const contentSnippet = blameLine.content ? ` Код: "${blameLine.content.trim()}".` : "";

	return `Строка ${lineNumber} в файле '${fileName}' изменена автором ${author} (${date}) в коммите ${hash} "${message}"${taskStr}.${contentSnippet}`;
}

function buildSymbolSummary(
	filePath: string,
	symbol: string,
	matchingLines: readonly number[],
	commits: readonly GitCommitInfo[],
	blameLines: readonly GitBlameLine[],
): string {
	const fileName = path.basename(filePath);
	const occurrencesStr =
		matchingLines.length > 0
			? `найден на строках ${matchingLines.slice(0, 5).join(", ")}${matchingLines.length > 5 ? "..." : ""} (всего ${matchingLines.length})`
			: "в текущей версии файла не найден";

	const latestCommit = commits.length > 0 ? commits[0] : null;
	const authors = new Set<string>();
	for (const bl of blameLines) {
		if (bl.author) {
			authors.add(bl.author);
		}
	}
	for (const c of commits) {
		if (c.author) {
			authors.add(c.author);
		}
	}
	const authorList = Array.from(authors).join(", ");

	if (!latestCommit) {
		return `Символ '${symbol}' в файле '${fileName}': ${occurrencesStr}. Авторы строк: ${authorList || "не определены"}.`;
	}

	const shortHash = latestCommit.commitHash.slice(0, 8);
	const date = latestCommit.date ? latestCommit.date.split("T")[0] : "неизвестно";
	const taskStr = latestCommit.taskRefs.length > 0 ? ` [задачи: ${latestCommit.taskRefs.join(", ")}]` : "";
	const totalCommitsStr = commits.length > 1 ? ` Всего коммитов с изменением символа: ${commits.length}.` : "";

	return `Символ '${symbol}' в файле '${fileName}': ${occurrencesStr}. Последнее изменение внес ${latestCommit.author} (${date}) в коммите ${shortHash} "${latestCommit.message}"${taskStr}.${totalCommitsStr}`;
}

export async function getGitBlameContext(
	filePath: string,
	symbolOrLine: string | number,
	projectRoot?: string,
): Promise<GitBlameContextResult> {
	const cwd = projectRoot || process.cwd();
	const isLineNumber =
		typeof symbolOrLine === "number" || (typeof symbolOrLine === "string" && /^\d+$/.test(symbolOrLine.trim()));

	if (isLineNumber) {
		const lineNum =
			typeof symbolOrLine === "number" ? Math.floor(symbolOrLine) : Number.parseInt(symbolOrLine.trim(), 10);
		const targetStr = String(lineNum);
		const blameLines = await runGitBlame(filePath, lineNum, lineNum, cwd);
		let commitInfo: GitCommitInfo | null = null;

		if (blameLines.length > 0 && blameLines[0].commitHash && !/^0+$/.test(blameLines[0].commitHash)) {
			commitInfo = await getCommitInfo(blameLines[0].commitHash, cwd);
		}

		let commits: GitCommitInfo[] = commitInfo ? [commitInfo] : [];
		if (commits.length === 0) {
			commits = await runGitLogForFile(filePath, 3, cwd);
		}

		const summary = buildLineSummary(filePath, lineNum, blameLines[0], commitInfo);

		return {
			filePath,
			target: targetStr,
			commits,
			blameLines,
			summary,
		};
	}

	const symbol = typeof symbolOrLine === "string" ? symbolOrLine.trim() : String(symbolOrLine);
	const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(cwd, filePath);

	let fileContent = "";
	try {
		fileContent = await fs.promises.readFile(fullPath, "utf-8");
	} catch {
		// File may not exist on disk or be unreadable
	}

	const matchingLines: number[] = [];
	if (fileContent) {
		const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const symbolRegex = new RegExp(`(?<![А-Яа-яЁёA-Za-z0-9_])${escaped}(?![А-Яа-яЁёA-Za-z0-9_])`, "i");
		const lines = fileContent.split(/\r?\n/);

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (symbolRegex.test(line) || line.toLowerCase().includes(symbol.toLowerCase())) {
				matchingLines.push(i + 1);
			}
		}
	}

	const blameLines: GitBlameLine[] = [];
	if (matchingLines.length > 0) {
		const ranges = groupIntoRanges(matchingLines).slice(0, 10);
		for (const r of ranges) {
			const rangeBlame = await runGitBlame(filePath, r.start, r.end, cwd);
			blameLines.push(...rangeBlame);
		}
	}

	let commits = await runGitLogForSymbol(filePath, symbol, 10, cwd);

	if (commits.length === 0 && blameLines.length > 0) {
		const seenHashes = new Set<string>();
		const collectedCommits: GitCommitInfo[] = [];

		for (const bl of blameLines) {
			if (bl.commitHash && !/^0+$/.test(bl.commitHash) && !seenHashes.has(bl.commitHash)) {
				seenHashes.add(bl.commitHash);
				const c = await getCommitInfo(bl.commitHash, cwd);
				if (c) {
					collectedCommits.push(c);
				}
				if (collectedCommits.length >= 5) {
					break;
				}
			}
		}
		if (collectedCommits.length > 0) {
			commits = collectedCommits;
		}
	}

	if (commits.length === 0) {
		commits = await runGitLogForFile(filePath, 3, cwd);
	}

	const summary = buildSymbolSummary(filePath, symbol, matchingLines, commits, blameLines);

	return {
		filePath,
		target: symbol,
		commits,
		blameLines,
		summary,
	};
}
