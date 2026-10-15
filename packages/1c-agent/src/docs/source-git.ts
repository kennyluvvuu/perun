// Чтение модулей BSL из последнего коммита (HEAD) локального git-репозитория проекта.
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { DocsSource, SourceFile } from "./docs-source.ts";

const execFileAsync = promisify(execFile);
const GIT_ENV: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };

async function git(args: readonly string[], cwd: string): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-c", "core.quotepath=false", ...args], {
		cwd,
		env: GIT_ENV,
		maxBuffer: 256 * 1024 * 1024,
		encoding: "utf8",
	});
	return stdout;
}

export async function readGitRevision(root: string): Promise<string | undefined> {
	try {
		return (await git(["rev-parse", "--verify", "HEAD"], root)).trim() || undefined;
	} catch {
		return undefined;
	}
}

function parseBatch(output: Buffer, blobs: readonly string[]): Map<string, string> {
	const contents = new Map<string, string>();
	let offset = 0;
	for (const blob of blobs) {
		const headerEnd = output.indexOf(10, offset);
		if (headerEnd === -1) {
			break;
		}
		const header = output.subarray(offset, headerEnd).toString("utf8").split(" ");
		if (header[1] === "missing" || header.length < 3) {
			offset = headerEnd + 1;
			continue;
		}
		const size = Number.parseInt(header[2], 10);
		const start = headerEnd + 1;
		contents.set(blob, output.subarray(start, start + size).toString("utf8"));
		offset = start + size + 1;
	}
	return contents;
}

function catFileBatch(root: string, blobs: readonly string[]): Promise<Map<string, string>> {
	return new Promise((resolve, reject) => {
		const child = spawn("git", ["cat-file", "--batch"], { cwd: root, env: GIT_ENV });
		const chunks: Buffer[] = [];
		child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
		child.stderr.resume();
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) {
				reject(new Error(`git cat-file завершился с кодом ${code}`));
				return;
			}
			resolve(parseBatch(Buffer.concat(chunks), blobs));
		});
		child.stdin.end(`${blobs.join("\n")}\n`);
	});
}

export function createGitSource(root: string): DocsSource {
	// Источник: дерево HEAD (git ls-tree) и содержимое блобов (git cat-file --batch).
	return {
		type: "git",
		root,
		revision: async () => {
			const revision = await readGitRevision(root);
			if (!revision) {
				throw new Error("В репозитории нет коммитов");
			}
			return revision;
		},
		list: async () => {
			const output = await git(["ls-tree", "-r", "-z", "HEAD"], root);
			const files = new Map<string, string>();
			for (const record of output.split("\0")) {
				const tab = record.indexOf("\t");
				const meta = record.slice(0, tab).split(" ");
				const filePath = record.slice(tab + 1);
				if (tab !== -1 && meta[1] === "blob" && filePath.toLowerCase().endsWith(".bsl")) {
					files.set(filePath, meta[2]);
				}
			}
			return files;
		},
		read: async (items: readonly SourceFile[]) => {
			const blobs = [...new Set(items.map((item) => item.blob))];
			const contents = await catFileBatch(root, blobs);
			const result = new Map<string, string>();
			for (const item of items) {
				const content = contents.get(item.blob);
				if (content !== undefined) {
					result.set(item.path, content);
				}
			}
			return result;
		},
	};
}
