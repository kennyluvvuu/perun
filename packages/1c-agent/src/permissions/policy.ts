import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionCheckResult, PermissionLevel } from "../types.ts";

const HOME_ENV = "$HOME";
const HOME_ENV_CURLY = "${" + "HOME}";

export const TARGET_PATH_KEYS = [
	"path",
	"file_path",
	"filePath",
	"targetPath",
	"target_path",
	"target",
	"outputPath",
	"output_path",
	"output",
	"cwd",
	"destination",
	"dest",
	"directory",
	"dir",
	"src",
	"features",
	"vanessaPath",
	"vrunnerPath",
	"out",
] as const;

export function extractAllTargetPaths(input: Record<string, unknown>): string[] {
	if (!input || typeof input !== "object") return [];
	const paths: string[] = [];

	const addIfValid = (val: unknown) => {
		if (typeof val === "string" && val.trim().length > 0) {
			const trimmed = val.trim();
			if (!paths.includes(trimmed)) {
				paths.push(trimmed);
			}
		}
	};

	for (const key of TARGET_PATH_KEYS) {
		addIfValid(input[key]);
	}

	for (const [k, v] of Object.entries(input)) {
		const lower = k.toLowerCase();
		if (
			lower.endsWith("path") ||
			lower === "file" ||
			lower === "dir" ||
			lower === "directory" ||
			lower === "src" ||
			lower === "dest" ||
			lower === "destination" ||
			lower === "cwd"
		) {
			addIfValid(v);
		}
	}

	if (input.args && typeof input.args === "object") {
		if (Array.isArray(input.args)) {
			for (const arg of input.args) {
				if (
					typeof arg === "string" &&
					(arg.startsWith("/") ||
						arg.startsWith("~") ||
						arg.startsWith(HOME_ENV) ||
						arg.startsWith(HOME_ENV_CURLY) ||
						/(^|[=/\\])\.\.([/\\]|$)/.test(arg))
				) {
					addIfValid(arg);
				}
			}
		} else {
			for (const [k, v] of Object.entries(input.args as Record<string, unknown>)) {
				const lower = k.toLowerCase();
				if (
					lower.endsWith("path") ||
					lower === "file" ||
					lower === "dir" ||
					lower === "directory" ||
					lower === "src" ||
					lower === "dest" ||
					lower === "destination" ||
					lower === "cwd"
				) {
					addIfValid(v);
				}
			}
		}
	}

	return paths;
}

export function extractTargetPath(input: Record<string, unknown>): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	for (const key of TARGET_PATH_KEYS) {
		const val = input[key];
		if (typeof val === "string" && val.trim().length > 0) {
			return val.trim();
		}
	}
	return undefined;
}

export const SYSTEM_BIN_DIRS = [
	"/bin/",
	"/usr/bin/",
	"/usr/local/bin/",
	"/opt/homebrew/bin/",
	"/sbin/",
	"/usr/sbin/",
] as const;

export function isSystemBinary(filePath: string): boolean {
	const normalized = filePath.replace(/\\/g, "/");
	return SYSTEM_BIN_DIRS.some((dir) => normalized.startsWith(dir));
}

export function resolvePath(projectRoot: string, filePath: string): string {
	let normalized = filePath.trim();
	if (normalized === "~" || normalized.startsWith("~/") || normalized.startsWith("~\\")) {
		const home = os.homedir();
		normalized = path.join(home, normalized.slice(1));
	} else if (
		normalized === HOME_ENV ||
		normalized.startsWith(`${HOME_ENV}/`) ||
		normalized.startsWith(`${HOME_ENV}\\`)
	) {
		const home = os.homedir();
		normalized = path.join(home, normalized.slice(5));
	} else if (
		normalized === HOME_ENV_CURLY ||
		normalized.startsWith(`${HOME_ENV_CURLY}/`) ||
		normalized.startsWith(`${HOME_ENV_CURLY}\\`)
	) {
		const home = os.homedir();
		normalized = path.join(home, normalized.slice(7));
	}
	return path.resolve(projectRoot, normalized);
}

export function isPathInsideProject(projectRoot: string, filePath: string): boolean {
	const resolved = resolvePath(projectRoot, filePath);
	const resolvedRoot = path.resolve(projectRoot);
	const rel = path.relative(resolvedRoot, resolved);
	return !rel.startsWith("..") && !path.isAbsolute(rel);
}

interface ParsedRedirect {
	op: string;
	target: string;
}

interface ParsedSegment {
	tokens: string[];
	redirects: ParsedRedirect[];
}

function parseBashCommand(command: string): ParsedSegment[] {
	const segments: ParsedSegment[] = [];
	let currentTokens: string[] = [];
	let currentRedirects: ParsedRedirect[] = [];
	let currentWord = "";
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let i = 0;
	const n = command.length;

	function flushWord() {
		if (currentWord.length > 0) {
			currentTokens.push(currentWord);
			currentWord = "";
		}
	}

	function flushSegment() {
		flushWord();
		if (currentTokens.length > 0 || currentRedirects.length > 0) {
			segments.push({
				tokens: currentTokens,
				redirects: currentRedirects,
			});
			currentTokens = [];
			currentRedirects = [];
		}
	}

	while (i < n) {
		const ch = command[i];

		if (inSingleQuote) {
			if (ch === "'") {
				inSingleQuote = false;
			} else {
				currentWord += ch;
			}
			i++;
			continue;
		}

		if (inDoubleQuote) {
			if (ch === '"') {
				inDoubleQuote = false;
			} else if (ch === "\\" && i + 1 < n) {
				currentWord += command[i + 1];
				i += 2;
				continue;
			} else {
				currentWord += ch;
			}
			i++;
			continue;
		}

		if (ch === "'") {
			inSingleQuote = true;
			i++;
			continue;
		}

		if (ch === '"') {
			inDoubleQuote = true;
			i++;
			continue;
		}

		if (ch === "\\" && i + 1 < n) {
			currentWord += command[i + 1];
			i += 2;
			continue;
		}

		if (ch === " " || ch === "\t" || ch === "\r") {
			flushWord();
			i++;
			continue;
		}

		if (ch === ";" || ch === "\n") {
			flushSegment();
			i++;
			continue;
		}

		if (ch === "&") {
			if (i + 1 < n && command[i + 1] === "&") {
				flushSegment();
				i += 2;
				continue;
			}
			if (i + 1 < n && command[i + 1] === ">") {
				// Handled in redirect
			} else {
				flushSegment();
				i++;
				continue;
			}
		}

		if (ch === "|") {
			if (i + 1 < n && command[i + 1] === "|") {
				flushSegment();
				i += 2;
				continue;
			}
			flushSegment();
			i++;
			continue;
		}

		if (ch === "(" || ch === ")") {
			flushSegment();
			i++;
			continue;
		}

		let isRedirect = false;
		let redirectOp = "";
		let matchLen = 0;

		if (ch === ">") {
			if (i + 1 < n && command[i + 1] === ">") {
				redirectOp = ">>";
				matchLen = 2;
				isRedirect = true;
			} else if (i + 1 < n && command[i + 1] === "&" && i + 2 < n && /[0-9]/.test(command[i + 2])) {
				currentWord += command.slice(i, i + 3);
				i += 3;
				continue;
			} else {
				redirectOp = ">";
				matchLen = 1;
				isRedirect = true;
			}
		} else if (ch === "<") {
			if (i + 1 < n && command[i + 1] === "<") {
				currentWord += "<<";
				i += 2;
				if (i < n && command[i] === "<") {
					currentWord += "<";
					i++;
				}
				continue;
			}
			redirectOp = "<";
			matchLen = 1;
			isRedirect = true;
		} else if ((ch === "1" || ch === "2") && i + 1 < n && command[i + 1] === ">" && currentWord.length === 0) {
			if (i + 2 < n && command[i + 2] === ">") {
				redirectOp = command.slice(i, i + 3);
				matchLen = 3;
				isRedirect = true;
			} else if (i + 2 < n && command[i + 2] === "&" && i + 3 < n && /[0-9]/.test(command[i + 3])) {
				currentWord += command.slice(i, i + 4);
				i += 4;
				continue;
			} else {
				redirectOp = command.slice(i, i + 2);
				matchLen = 2;
				isRedirect = true;
			}
		} else if (ch === "&" && i + 1 < n && command[i + 1] === ">" && currentWord.length === 0) {
			redirectOp = "&>";
			matchLen = 2;
			isRedirect = true;
		}

		if (isRedirect) {
			flushWord();
			i += matchLen;
			while (i < n && (command[i] === " " || command[i] === "\t")) {
				i++;
			}
			let target = "";
			let targetSingleQuote = false;
			let targetDoubleQuote = false;
			while (i < n) {
				const tc = command[i];
				if (targetSingleQuote) {
					if (tc === "'") {
						targetSingleQuote = false;
					} else {
						target += tc;
					}
					i++;
					continue;
				}
				if (targetDoubleQuote) {
					if (tc === '"') {
						targetDoubleQuote = false;
					} else if (tc === "\\" && i + 1 < n) {
						target += command[i + 1];
						i += 2;
						continue;
					} else {
						target += tc;
					}
					i++;
					continue;
				}
				if (tc === "'") {
					targetSingleQuote = true;
					i++;
					continue;
				}
				if (tc === '"') {
					targetDoubleQuote = true;
					i++;
					continue;
				}
				if (
					tc === " " ||
					tc === "\t" ||
					tc === "\r" ||
					tc === "\n" ||
					tc === ";" ||
					tc === "|" ||
					tc === "&" ||
					tc === ">" ||
					tc === "<" ||
					tc === "(" ||
					tc === ")"
				) {
					break;
				}
				target += tc;
				i++;
			}
			if (target.length > 0) {
				currentRedirects.push({ op: redirectOp, target });
			}
			continue;
		}

		currentWord += ch;
		i++;
	}

	flushSegment();
	return segments;
}

export function isBashCommandOutsideProject(
	command: string,
	projectRoot: string,
	cwd?: string,
): { isOutside: boolean; target?: string; reason?: string } {
	if (!command || command.trim().length === 0) {
		if (cwd !== undefined && cwd.trim().length > 0) {
			if (!isPathInsideProject(projectRoot, cwd)) {
				return {
					isOutside: true,
					target: cwd,
					reason: `Рабочая директория команды ('${cwd}') находится за пределами каталога проекта (${projectRoot}).`,
				};
			}
		}
		return { isOutside: false };
	}

	if (cwd !== undefined && cwd.trim().length > 0) {
		if (!isPathInsideProject(projectRoot, cwd)) {
			return {
				isOutside: true,
				target: cwd,
				reason: `Рабочая директория команды ('${cwd}') находится за пределами каталога проекта (${projectRoot}).`,
			};
		}
	}

	const effectiveCwd = cwd && cwd.trim().length > 0 ? resolvePath(projectRoot, cwd) : path.resolve(projectRoot);
	const segments = parseBashCommand(command);

	for (const segment of segments) {
		// 1. Check redirects (>, >>, <)
		for (const redir of segment.redirects) {
			const target = redir.target;
			if (target === "~" || target.startsWith("~/") || target.startsWith("~\\")) {
				const expanded = path.join(os.homedir(), target.slice(1));
				if (!isPathInsideProject(projectRoot, expanded)) {
					return {
						isOutside: true,
						target,
						reason: `Редирект в файл за пределами каталога проекта: '${target}'.`,
					};
				}
				continue;
			}
			if (target.includes(HOME_ENV) || target.includes(HOME_ENV_CURLY)) {
				const expanded = target.replace(/\$\{HOME\}/g, os.homedir()).replace(/\$HOME/g, os.homedir());
				if (!isPathInsideProject(projectRoot, expanded)) {
					return {
						isOutside: true,
						target,
						reason: `Редирект в файл за пределами каталога проекта: '${target}'.`,
					};
				}
				continue;
			}
			if (/(^|[/\\])\.\.([/\\]|$)/.test(target)) {
				const resolved = path.resolve(effectiveCwd, target);
				if (!isPathInsideProject(projectRoot, resolved)) {
					return {
						isOutside: true,
						target,
						reason: `Редирект в файл за пределами каталога проекта: '${target}'.`,
					};
				}
				continue;
			}
			if (target.startsWith("/") || target.startsWith("\\")) {
				if (target === "/" || target === "\\" || !isPathInsideProject(projectRoot, target)) {
					return {
						isOutside: true,
						target,
						reason: `Редирект в файл за пределами каталога проекта: '${target}'.`,
					};
				}
				continue;
			}
			const resolved = path.resolve(effectiveCwd, target);
			if (!isPathInsideProject(projectRoot, resolved)) {
				return {
					isOutside: true,
					target,
					reason: `Редирект в файл за пределами каталога проекта: '${target}'.`,
				};
			}
		}

		// 2. Check tokens
		const firstExecIndex = segment.tokens.findIndex((t) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(t));
		let execToken: string | undefined;

		if (firstExecIndex !== -1) {
			execToken = segment.tokens[firstExecIndex];

			const baseExec = path.basename(execToken);
			if (baseExec === "bash" || baseExec === "sh" || baseExec === "zsh") {
				const cIdx = segment.tokens.indexOf("-c", firstExecIndex + 1);
				if (cIdx !== -1 && cIdx + 1 < segment.tokens.length) {
					const subCmd = segment.tokens[cIdx + 1];
					const subCheck = isBashCommandOutsideProject(subCmd, projectRoot, cwd);
					if (subCheck.isOutside) {
						return subCheck;
					}
				}
			} else if (baseExec === "eval") {
				const subCmd = segment.tokens.slice(firstExecIndex + 1).join(" ");
				if (subCmd.length > 0) {
					const subCheck = isBashCommandOutsideProject(subCmd, projectRoot, cwd);
					if (subCheck.isOutside) {
						return subCheck;
					}
				}
			}

			if (execToken === "/" || execToken === "\\") {
				return {
					isOutside: true,
					target: "/",
					reason: "Команда обращается к корневой директории файловой системы ('/').",
				};
			}

			if (execToken.startsWith("/") || execToken.startsWith("\\")) {
				if (!isSystemBinary(execToken) && !isPathInsideProject(projectRoot, execToken)) {
					return {
						isOutside: true,
						target: execToken,
						reason: `Исполняемый файл '${execToken}' находится за пределами каталога проекта (${projectRoot}).`,
					};
				}
			}
		}

		for (let idx = 0; idx < segment.tokens.length; idx++) {
			const token = segment.tokens[idx];

			if (
				idx === firstExecIndex &&
				execToken &&
				(execToken.startsWith("/") || execToken.startsWith("\\")) &&
				isSystemBinary(execToken)
			) {
				continue;
			}

			if (token === "/" || token === "\\") {
				return {
					isOutside: true,
					target: "/",
					reason: "Команда обращается к корневой директории файловой системы ('/').",
				};
			}

			const checkPart = token.includes("=") ? token.slice(token.indexOf("=") + 1) : token;

			if (
				checkPart === "~" ||
				checkPart.startsWith("~/") ||
				checkPart.startsWith("~\\") ||
				token === "~" ||
				token.startsWith("~/") ||
				token.startsWith("~\\")
			) {
				const targetPath = checkPart.startsWith("~") ? checkPart : token;
				const expanded = path.join(os.homedir(), targetPath.slice(1));
				if (!isPathInsideProject(projectRoot, expanded)) {
					return {
						isOutside: true,
						target: token,
						reason: `Путь с тильдой '${token}' указывает за пределы каталога проекта.`,
					};
				}
				continue;
			}

			if (token.includes(HOME_ENV) || token.includes(HOME_ENV_CURLY)) {
				const expanded = checkPart.replace(/\$\{HOME\}/g, os.homedir()).replace(/\$HOME/g, os.homedir());
				if (!isPathInsideProject(projectRoot, expanded)) {
					return {
						isOutside: true,
						target: token,
						reason: `Путь с переменной HOME ('${token}') указывает за пределы каталога проекта.`,
					};
				}
				continue;
			}

			if (/(^|[=/\\])\.\.([/\\]|$)/.test(token)) {
				const resolved = path.resolve(effectiveCwd, checkPart);
				if (!isPathInsideProject(projectRoot, resolved)) {
					return {
						isOutside: true,
						target: token,
						reason: `Путь с переходом вверх по каталогам ('${token}') выходит за пределы проекта.`,
					};
				}
				continue;
			}

			if (checkPart.startsWith("/") || checkPart.startsWith("\\")) {
				if (checkPart === "/" || checkPart === "\\" || !isPathInsideProject(projectRoot, checkPart)) {
					return {
						isOutside: true,
						target: token,
						reason: `Абсолютный путь '${token}' находится за пределами каталога проекта (${projectRoot}).`,
					};
				}
			}
		}
	}

	return { isOutside: false };
}

export type RemoteConfirmFn = (title: string, message: string, signal: AbortSignal) => Promise<boolean | undefined>;

export class PermissionPolicy {
	private level: PermissionLevel;
	private projectRoot: string;
	private remoteConfirm?: RemoteConfirmFn;

	constructor(initialLevel: PermissionLevel = "auto-approve", projectRoot: string = process.cwd()) {
		this.level = initialLevel;
		this.projectRoot = path.resolve(projectRoot);
	}

	public getLevel(): PermissionLevel {
		return this.level;
	}

	public setLevel(level: PermissionLevel): void {
		this.level = level;
	}

	public getProjectRoot(): string {
		return this.projectRoot;
	}

	public setProjectRoot(projectRoot: string): void {
		this.projectRoot = path.resolve(projectRoot);
	}

	public setRemoteConfirm(fn?: RemoteConfirmFn): void {
		this.remoteConfirm = fn;
	}

	public getRemoteConfirm(): RemoteConfirmFn | undefined {
		return this.remoteConfirm;
	}

	public isInsideProject(filePath: string): boolean {
		return isPathInsideProject(this.projectRoot, filePath);
	}

	public checkToolCall(toolName: string, input: Record<string, unknown>, contextCwd?: string): PermissionCheckResult {
		// 1. FIRST check if operation escapes projectRoot
		let isOutside = false;
		let outsideReason: string | undefined;
		let outsideTarget: string | undefined;

		if (toolName === "bash" || toolName === "powershell") {
			const command =
				typeof input?.command === "string" ? input.command : typeof input?.cmd === "string" ? input.cmd : "";
			const cwd = typeof input?.cwd === "string" && input.cwd.trim().length > 0 ? input.cwd.trim() : contextCwd;

			const bashCheck = isBashCommandOutsideProject(command, this.projectRoot, cwd);
			if (bashCheck.isOutside) {
				isOutside = true;
				outsideTarget = bashCheck.target;
				outsideReason = bashCheck.reason;
			}
		}

		if (!isOutside) {
			const targetPaths = extractAllTargetPaths(input);
			for (const p of targetPaths) {
				if (!this.isInsideProject(p)) {
					isOutside = true;
					outsideTarget = p;
					outsideReason = `Целевой путь операции '${p}' находится за пределами каталога проекта (${this.projectRoot}).`;
					break;
				}
			}
		}

		// If operation is outside projectRoot, confirmation is MANDATORY even in YOLO mode!
		if (isOutside) {
			return {
				allowed: false,
				requiresUserConfirmation: true,
				reason:
					outsideReason ||
					`Целевой путь операции ('${outsideTarget}') находится за пределами каталога проекта (${this.projectRoot}). Требуется подтверждение пользователя.`,
			};
		}

		// Operation is INSIDE projectRoot:
		// A. YOLO mode: autopilot without prompts
		if (this.level === "yolo") {
			return { allowed: true, requiresUserConfirmation: false };
		}

		// B. Safe read tools inside projectRoot are allowed without confirmation
		const safeReadTools = new Set([
			"read",
			"grep",
			"find",
			"ls",
			"1c_call_hierarchy",
			"1c_impact_analysis",
			"1c_ast_symbols",
			"1c_docs_search",
			"1c_docs_read",
			"1c_docs_write",
			"1c_docs_outdated",
		]);

		if (safeReadTools.has(toolName)) {
			return { allowed: true, requiresUserConfirmation: false };
		}

		const action = typeof input?.action === "string" ? input.action : "";
		if (
			(toolName === "1c_md" && (action === "info" || action === "validate")) ||
			(toolName === "1c_ib" && action === "status")
		) {
			return { allowed: true, requiresUserConfirmation: false };
		}

		// C. STRICT mode: all mutating tools and commands require interactive user confirmation
		if (this.level === "strict") {
			return {
				allowed: false,
				requiresUserConfirmation: true,
				reason: `Требуется подтверждение выполнения '${toolName}' в строгом режиме (strict).`,
			};
		}

		// D. AUTO-APPROVE mode
		if (this.level === "auto-approve") {
			// Routine file modifications within project directory are auto-approved
			if (toolName === "edit" || toolName === "write" || toolName === "bsl_fix_standards") {
				return { allowed: true, requiresUserConfirmation: false };
			}

			// Метаданные, информационная база и тесты внутри проекта разрешены
			if (toolName === "1c_md" || toolName === "1c_ib" || toolName === "1c_vanessa") {
				return { allowed: true, requiresUserConfirmation: false };
			}

			// System commands (bash/powershell) require confirmation in auto-approve mode
			if (toolName === "bash" || toolName === "powershell") {
				return {
					allowed: false,
					requiresUserConfirmation: true,
					reason: `Выполнение команд терминала (${toolName}) требует подтверждения пользователя.`,
				};
			}
		}

		return { allowed: true, requiresUserConfirmation: false };
	}

	public async handleToolCall(
		toolCall: { toolName: string; input: Record<string, unknown> },
		ctx?: ExtensionContext,
	): Promise<{ block: boolean; reason?: string }> {
		const check = this.checkToolCall(toolCall.toolName, toolCall.input, ctx?.cwd);
		if (check.allowed) {
			return { block: false };
		}

		if (check.requiresUserConfirmation) {
			const title = `[1C Безопасность]: Разрешить вызов инструмента '${toolCall.toolName}'?`;
			const message = check.reason || `Инструмент: ${toolCall.toolName}`;

			const hasLocalUI = ctx?.hasUI !== false && Boolean(ctx?.ui);
			const hasRemote = typeof this.remoteConfirm === "function";

			if (!hasLocalUI && !hasRemote) {
				return {
					block: true,
					reason: `Вызов '${toolCall.toolName}' заблокирован: действие не подтверждено пользователем (${check.reason || this.level}).`,
				};
			}

			if (!hasLocalUI && hasRemote) {
				const remoteSignal = ctx?.signal || new AbortController().signal;
				const confirmed = await this.remoteConfirm!(title, message, remoteSignal).catch(() => undefined);
				if (confirmed === true) {
					return { block: false };
				}
				return {
					block: true,
					reason: `Вызов '${toolCall.toolName}' заблокирован: действие не подтверждено пользователем (${check.reason || this.level}).`,
				};
			}

			if (hasLocalUI && !hasRemote) {
				let confirmed = false;
				const ui = ctx!.ui as {
					askUser?: (title: string, message: string) => Promise<unknown>;
					confirm?: (title: string, message: string) => Promise<unknown>;
				};
				if (typeof ui.askUser === "function") {
					confirmed = Boolean(await ui.askUser(title, message));
				} else if (typeof ui.confirm === "function") {
					confirmed = Boolean(await ui.confirm(title, message));
				}

				if (confirmed) {
					return { block: false };
				}
				return {
					block: true,
					reason: `Вызов '${toolCall.toolName}' заблокирован: действие не подтверждено пользователем (${check.reason || this.level}).`,
				};
			}

			if (hasLocalUI && hasRemote) {
				const localAc = new AbortController();
				const remoteAc = new AbortController();

				let confirmed = false;
				let onParentAbort: (() => void) | undefined;

				try {
					confirmed = await new Promise<boolean>((resolve) => {
						let settled = false;
						let localFinished = false;
						let remoteFinished = false;

						const checkAllFinished = () => {
							if (!settled && localFinished && remoteFinished) {
								settled = true;
								resolve(false);
							}
						};

						onParentAbort = () => {
							localAc.abort(ctx?.signal?.reason);
							remoteAc.abort(ctx?.signal?.reason);
							if (!settled) {
								settled = true;
								resolve(false);
							}
						};

						if (ctx?.signal) {
							if (ctx.signal.aborted) {
								localAc.abort(ctx.signal.reason);
								remoteAc.abort(ctx.signal.reason);
								settled = true;
								resolve(false);
								return;
							}
							ctx.signal.addEventListener("abort", onParentAbort, { once: true });
						}

						// Remote prompt
						Promise.resolve()
							.then(() => this.remoteConfirm!(title, message, remoteAc.signal))
							.then((remoteAnswer) => {
								if (settled) return;
								if (typeof remoteAnswer === "boolean") {
									settled = true;
									localAc.abort();
									resolve(remoteAnswer);
								} else {
									remoteFinished = true;
									checkAllFinished();
								}
							})
							.catch(() => {
								if (settled) return;
								remoteFinished = true;
								checkAllFinished();
							});

						// Local prompt
						const runLocal = async (): Promise<boolean | undefined> => {
							const ui = ctx!.ui as {
								askUser?: (title: string, message: string, opts?: { signal?: AbortSignal }) => Promise<unknown>;
								confirm?: (title: string, message: string, opts?: { signal?: AbortSignal }) => Promise<unknown>;
							};
							if (typeof ui.askUser === "function") {
								const ans = await ui.askUser(title, message, { signal: localAc.signal });
								return typeof ans === "boolean" ? ans : ans !== undefined ? Boolean(ans) : undefined;
							}
							if (typeof ui.confirm === "function") {
								const ans = await ui.confirm(title, message, { signal: localAc.signal });
								return typeof ans === "boolean" ? ans : Boolean(ans);
							}
							return false;
						};

						runLocal()
							.then((localAnswer) => {
								if (settled) return;
								if (typeof localAnswer === "boolean") {
									settled = true;
									remoteAc.abort();
									resolve(localAnswer);
								} else {
									localFinished = true;
									checkAllFinished();
								}
							})
							.catch(() => {
								if (settled) return;
								localFinished = true;
								checkAllFinished();
							});
					});
				} finally {
					if (ctx?.signal && onParentAbort) {
						ctx.signal.removeEventListener("abort", onParentAbort);
					}
				}

				if (confirmed) {
					return { block: false };
				}
				return {
					block: true,
					reason: `Вызов '${toolCall.toolName}' заблокирован: действие не подтверждено пользователем (${check.reason || this.level}).`,
				};
			}
		}

		return { block: true, reason: check.reason || "Действие запрещено политикой безопасности." };
	}
}

export async function handleToolCall(
	toolCall: { toolName: string; input: Record<string, unknown> },
	ctx?: ExtensionContext,
	policy?: PermissionPolicy,
): Promise<{ block: boolean; reason?: string }> {
	const activePolicy = policy ?? new PermissionPolicy("auto-approve", ctx?.cwd);
	return activePolicy.handleToolCall(toolCall, ctx);
}
