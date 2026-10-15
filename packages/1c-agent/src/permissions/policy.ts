import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionCheckResult, PermissionLevel } from "../types.ts";

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
] as const;

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

export function resolvePath(projectRoot: string, filePath: string): string {
	let normalized = filePath.trim();
	if (normalized === "~" || normalized.startsWith("~/") || normalized.startsWith("~\\")) {
		const home = os.homedir();
		normalized = path.join(home, normalized.slice(1));
	}
	return path.resolve(projectRoot, normalized);
}

export function isPathInsideProject(projectRoot: string, filePath: string): boolean {
	const resolved = resolvePath(projectRoot, filePath);
	const resolvedRoot = path.resolve(projectRoot);
	const rel = path.relative(resolvedRoot, resolved);
	return !rel.startsWith("..") && !path.isAbsolute(rel);
}

export class PermissionPolicy {
	private level: PermissionLevel;
	private projectRoot: string;

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

	public isInsideProject(filePath: string): boolean {
		return isPathInsideProject(this.projectRoot, filePath);
	}

	public checkToolCall(toolName: string, input: Record<string, unknown>): PermissionCheckResult {
		// YOLO mode: autopilot without prompts
		if (this.level === "yolo") {
			return { allowed: true, requiresUserConfirmation: false };
		}

		// Read-only tools are always safe in both strict and auto-approve modes
		const safeReadTools = new Set([
			"read",
			"grep",
			"find",
			"ls",
			"1c_call_hierarchy",
			"1c_impact_analysis",
			"1c_ast_symbols",
		]);

		if (safeReadTools.has(toolName)) {
			return { allowed: true, requiresUserConfirmation: false };
		}

		// Determine target path of operation (path, file_path, targetPath, outputPath, cwd, etc.)
		const targetPath = extractTargetPath(input);
		const isOutside = targetPath !== undefined && !this.isInsideProject(targetPath);

		// If path is outside projectRoot, force verification logic into STRICT mode (even in auto-approve)
		const effectiveLevel: PermissionLevel = isOutside && this.level === "auto-approve" ? "strict" : this.level;

		// STRICT mode: all mutating tools and commands require interactive user confirmation
		if (effectiveLevel === "strict") {
			return {
				allowed: false,
				requiresUserConfirmation: true,
				reason: isOutside
					? `Целевой путь операции '${targetPath}' находится за пределами каталога проекта (${this.projectRoot}). Требуется подтверждение в строгом режиме (strict).`
					: `Требуется подтверждение выполнения '${toolName}' в строгом режиме (strict).`,
			};
		}

		// AUTO-APPROVE mode
		if (effectiveLevel === "auto-approve") {
			// Routine file modifications within project directory are auto-approved
			if (toolName === "edit" || toolName === "write" || toolName === "bsl_fix_standards") {
				if (targetPath && this.isInsideProject(targetPath)) {
					return { allowed: true, requiresUserConfirmation: false };
				}
				// Writes outside project root require confirmation
				return {
					allowed: false,
					requiresUserConfirmation: true,
					reason: `Запись за пределы каталога проекта (${targetPath}) требует подтверждения.`,
				};
			}

			// Subagents and 1c_vanessa in auto-approve are allowed
			if (toolName === "1c_subagent" || toolName === "1c_vanessa") {
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
		const check = this.checkToolCall(toolCall.toolName, toolCall.input);
		if (check.allowed) {
			return { block: false };
		}

		if (check.requiresUserConfirmation) {
			if (ctx?.ui) {
				const title = `[1C Безопасность]: Разрешить вызов инструмента '${toolCall.toolName}'?`;
				const message = check.reason || `Инструмент: ${toolCall.toolName}`;

				let confirmed = false;
				if (typeof (ctx.ui as any).askUser === "function") {
					confirmed = Boolean(await (ctx.ui as any).askUser(title, message));
				} else if (typeof ctx.ui.confirm === "function") {
					confirmed = Boolean(await ctx.ui.confirm(title, message));
				}

				if (confirmed) {
					return { block: false };
				}
			}
			return {
				block: true,
				reason: `Вызов '${toolCall.toolName}' заблокирован: действие не подтверждено пользователем (${check.reason || this.level}).`,
			};
		}

		return { block: true, reason: check.reason || "Действие запрещено политикой безопасности." };
	}
}

export async function handleToolCall(
	toolCall: { toolName: string; input: Record<string, unknown> },
	ctx?: ExtensionContext,
	policy?: PermissionPolicy,
): Promise<{ block: boolean; reason?: string }> {
	const activePolicy = policy ?? new PermissionPolicy();
	return activePolicy.handleToolCall(toolCall, ctx);
}
