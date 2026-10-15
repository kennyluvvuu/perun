import { execFile } from "node:child_process";
import * as path from "node:path";
import { promisify } from "node:util";
import type { GitBlameLine, GitCommitInfo, GitFileChange, GitStatus } from "./types.ts";

const execFileAsync = promisify(execFile);

const TASK_REF_REGEX = /(?<![А-Яа-яЁёA-Za-z0-9_])(?:#\d+|[A-ZА-ЯЁ]{2,}-\d+)(?![А-Яа-яЁёA-Za-z0-9_])/g;

export function extractTaskRefs(message: string): string[] {
	if (!message) {
		return [];
	}
	const matches = message.match(TASK_REF_REGEX);
	if (!matches) {
		return [];
	}
	return Array.from(new Set(matches));
}

interface GitExecResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

async function execGit(args: string[], cwd?: string): Promise<GitExecResult> {
	const defaultEnv: NodeJS.ProcessEnv = {
		...process.env,
		GIT_TERMINAL_PROMPT: "0",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL || "/dev/null",
	};

	try {
		const { stdout, stderr } = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
			cwd: cwd || process.cwd(),
			maxBuffer: 10 * 1024 * 1024,
			env: defaultEnv,
		});
		return { stdout: stdout.toString(), stderr: stderr.toString(), exitCode: 0 };
	} catch (error: unknown) {
		const execError = error as { stdout?: string | Buffer; stderr?: string | Buffer; code?: number };
		return {
			stdout: execError.stdout?.toString() ?? "",
			stderr: execError.stderr?.toString() ?? "",
			exitCode: typeof execError.code === "number" ? execError.code : 1,
		};
	}
}

function parseDiffNameStatus(output: string): GitFileChange[] {
	const changes: GitFileChange[] = [];
	const seen = new Set<string>();
	const lines = output.split(/\r?\n/);

	for (const rawLine of lines) {
		const line = rawLine.trim();
		if (!line) {
			continue;
		}
		const parts = line.split("\t");
		if (parts.length < 2) {
			continue;
		}
		const statusChar = parts[0].trim().charAt(0).toUpperCase();
		let status: GitStatus = "M";
		if (
			statusChar === "A" ||
			statusChar === "M" ||
			statusChar === "D" ||
			statusChar === "R" ||
			statusChar === "C" ||
			statusChar === "U"
		) {
			status = statusChar;
		}
		const filePath = (status === "R" || status === "C") && parts.length >= 3 ? parts[2].trim() : parts[1].trim();
		if (filePath && !seen.has(filePath)) {
			seen.add(filePath);
			changes.push({ path: filePath, status });
		}
	}
	return changes;
}

export async function getChangedFiles(ref?: string, cwd?: string): Promise<GitFileChange[]> {
	const targetRef = ref?.trim();

	if (targetRef === "staged") {
		const { stdout, exitCode } = await execGit(["diff", "--name-status", "--cached"], cwd);
		if (exitCode !== 0) {
			return [];
		}
		return parseDiffNameStatus(stdout);
	}

	if (targetRef === "working") {
		const { stdout: diffStdout, exitCode: diffCode } = await execGit(["diff", "--name-status"], cwd);
		const changes = diffCode === 0 ? parseDiffNameStatus(diffStdout) : [];
		const { stdout: untrackedStdout, exitCode: untrackedCode } = await execGit(
			["ls-files", "--others", "--exclude-standard"],
			cwd,
		);
		if (untrackedCode === 0 && untrackedStdout) {
			const existingPaths = new Set(changes.map((c) => c.path));
			for (const line of untrackedStdout.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed && !existingPaths.has(trimmed)) {
					existingPaths.add(trimmed);
					changes.push({ path: trimmed, status: "A" });
				}
			}
		}
		return changes;
	}

	const effectiveRef = targetRef && targetRef.length > 0 ? targetRef : "HEAD";
	const { stdout, exitCode } = await execGit(["diff", "--name-status", effectiveRef], cwd);
	if (exitCode === 0) {
		const changes = parseDiffNameStatus(stdout);
		const { stdout: untrackedStdout, exitCode: untrackedCode } = await execGit(
			["ls-files", "--others", "--exclude-standard"],
			cwd,
		);
		if (untrackedCode === 0 && untrackedStdout) {
			const existingPaths = new Set(changes.map((c) => c.path));
			for (const line of untrackedStdout.split(/\r?\n/)) {
				const trimmed = line.trim();
				if (trimmed && !existingPaths.has(trimmed)) {
					existingPaths.add(trimmed);
					changes.push({ path: trimmed, status: "A" });
				}
			}
		}
		return changes;
	}

	const { stdout: workingStdout } = await execGit(["diff", "--name-status"], cwd);
	return parseDiffNameStatus(workingStdout);
}

export async function getFileContentAtRef(filePath: string, ref: string, cwd?: string): Promise<string | null> {
	if (!filePath || !ref) {
		return null;
	}

	const workingDir = cwd || process.cwd();
	const normalizedPath = path.isAbsolute(filePath)
		? path.relative(workingDir, filePath).replace(/\\/g, "/")
		: filePath.replace(/\\/g, "/");

	const cleanPath = normalizedPath.startsWith("./") ? normalizedPath.slice(2) : normalizedPath;
	const gitSpec = `${ref}:./${cleanPath}`;

	const { stdout, exitCode } = await execGit(["show", gitSpec], cwd);
	if (exitCode !== 0) {
		const fallbackSpec = `${ref}:${cleanPath}`;
		const fallbackResult = await execGit(["show", fallbackSpec], cwd);
		if (fallbackResult.exitCode !== 0) {
			return null;
		}
		return fallbackResult.stdout;
	}
	return stdout;
}

export async function runGitBlame(
	filePath: string,
	startLine: number,
	endLine: number,
	cwd?: string,
): Promise<GitBlameLine[]> {
	if (!filePath) {
		return [];
	}

	const start = Math.max(1, Math.floor(startLine));
	const end = Math.max(start, Math.floor(endLine));

	const { stdout, exitCode } = await execGit(
		["blame", "-L", `${start},${end}`, "--line-porcelain", "--", filePath],
		cwd,
	);
	if (exitCode !== 0 || !stdout) {
		return [];
	}

	const lines = stdout.split(/\r?\n/);
	const blameLines: GitBlameLine[] = [];

	let currentCommit = "";
	let currentLineNum = 0;
	let currentAuthor = "";
	let currentAuthorTime = "";
	let currentSummary = "";

	for (const rawLine of lines) {
		if (rawLine.startsWith("\t")) {
			const content = rawLine.slice(1);
			const dateStr = currentAuthorTime ? new Date(Number.parseInt(currentAuthorTime, 10) * 1000).toISOString() : "";

			blameLines.push({
				commitHash: currentCommit,
				author: currentAuthor,
				date: dateStr,
				line: currentLineNum,
				content,
				summary: currentSummary,
			});
			continue;
		}

		const spaceIdx = rawLine.indexOf(" ");
		if (spaceIdx === -1) {
			continue;
		}

		const key = rawLine.slice(0, spaceIdx);
		const rest = rawLine.slice(spaceIdx + 1);

		if (key.length === 40 || key.length === 64) {
			currentCommit = key;
			const tokens = rest.split(" ");
			const lineNum = Number.parseInt(tokens[1], 10);
			currentLineNum = Number.isNaN(lineNum) ? 0 : lineNum;
		} else if (key === "author") {
			currentAuthor = rest;
		} else if (key === "author-time") {
			currentAuthorTime = rest;
		} else if (key === "summary") {
			currentSummary = rest;
		}
	}

	return blameLines;
}

function parseCommitsFromFormat(output: string): GitCommitInfo[] {
	if (!output) {
		return [];
	}

	const records = output.split("\x1e");
	const commits: GitCommitInfo[] = [];

	for (const record of records) {
		const trimmed = record.trim();
		if (!trimmed) {
			continue;
		}
		const parts = trimmed.split("\x1f");
		const commitHash = parts[0]?.trim() ?? "";
		const author = parts[1]?.trim() ?? "";
		const date = parts[2]?.trim() ?? "";
		const message = parts[3]?.trim() ?? "";
		const taskRefs = extractTaskRefs(message);

		if (commitHash) {
			commits.push({
				commitHash,
				author,
				date,
				message,
				taskRefs,
			});
		}
	}

	return commits;
}

export async function runGitLogForSymbol(
	filePath: string,
	symbol: string,
	maxCount: number = 10,
	cwd?: string,
): Promise<GitCommitInfo[]> {
	if (!filePath || !symbol) {
		return [];
	}

	const count = Math.max(1, maxCount);
	const { stdout, exitCode } = await execGit(
		["log", `-n${count}`, `-S${symbol}`, "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", "--", filePath],
		cwd,
	);
	if (exitCode !== 0) {
		return [];
	}

	return parseCommitsFromFormat(stdout);
}

export async function runGitLogForFile(
	filePath: string,
	maxCount: number = 10,
	cwd?: string,
): Promise<GitCommitInfo[]> {
	if (!filePath) {
		return [];
	}

	const count = Math.max(1, maxCount);
	const { stdout, exitCode } = await execGit(
		["log", `-n${count}`, "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", "--", filePath],
		cwd,
	);
	if (exitCode !== 0) {
		return [];
	}

	return parseCommitsFromFormat(stdout);
}

export async function getCommitInfo(commitHash: string, cwd?: string): Promise<GitCommitInfo | null> {
	if (!commitHash || /^0+$/.test(commitHash)) {
		return null;
	}

	const { stdout, exitCode } = await execGit(["log", "-1", "--format=%H%x1f%an%x1f%aI%x1f%B%x1e", commitHash], cwd);
	if (exitCode !== 0) {
		return null;
	}

	const commits = parseCommitsFromFormat(stdout);
	return commits.length > 0 ? commits[0] : null;
}
