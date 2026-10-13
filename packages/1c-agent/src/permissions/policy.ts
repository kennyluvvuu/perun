import * as path from "node:path";
import type { PermissionCheckResult, PermissionLevel } from "../types.ts";

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

	public setProjectRoot(projectRoot: string): void {
		this.projectRoot = path.resolve(projectRoot);
	}

	public isInsideProject(filePath: string): boolean {
		const resolved = path.resolve(this.projectRoot, filePath);
		const rel = path.relative(this.projectRoot, resolved);
		return !rel.startsWith("..") && !path.isAbsolute(rel);
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

		// STRICT mode: all mutating tools and commands require interactive user confirmation
		if (this.level === "strict") {
			return {
				allowed: false,
				requiresUserConfirmation: true,
				reason: `Требуется подтверждение выполнения '${toolName}' в строгом режиме (strict).`,
			};
		}

		// AUTO-APPROVE mode
		if (this.level === "auto-approve") {
			// Routine file modifications within project directory are auto-approved
			if (toolName === "edit" || toolName === "write" || toolName === "bsl_fix_standards") {
				const rawPath = (input.path || input.file_path || input.target) as string | undefined;
				if (rawPath && this.isInsideProject(rawPath)) {
					return { allowed: true, requiresUserConfirmation: false };
				}
				// Writes outside project root require confirmation
				return {
					allowed: false,
					requiresUserConfirmation: true,
					reason: `Запись за пределы каталога проекта (${rawPath}) требует подтверждения.`,
				};
			}

			// Subagents in auto-approve are allowed
			if (toolName === "1c_subagent") {
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
}
