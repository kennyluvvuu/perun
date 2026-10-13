import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PermissionLevel } from "../types.ts";
import { PermissionPolicy } from "./policy.ts";

export class PermissionManager {
	private readonly policy: PermissionPolicy;

	constructor(initialLevel: PermissionLevel = "auto-approve", projectRoot?: string) {
		this.policy = new PermissionPolicy(initialLevel, projectRoot);
	}

	public getLevel(): PermissionLevel {
		return this.policy.getLevel();
	}

	public setLevel(level: PermissionLevel, ctx?: ExtensionContext): void {
		this.policy.setLevel(level);
		this.updateUI(ctx);
	}

	public cycleLevel(ctx?: ExtensionContext): PermissionLevel {
		const levels: PermissionLevel[] = ["strict", "auto-approve", "yolo"];
		const current = this.policy.getLevel();
		const next = levels[(levels.indexOf(current) + 1) % levels.length];
		this.setLevel(next, ctx);
		return next;
	}

	public updateUI(ctx?: ExtensionContext): void {
		if (!ctx?.ui) return;
		const level = this.policy.getLevel();
		const badge = `[Права: ${level.toUpperCase()}]`;
		const color = level === "strict" ? "warning" : level === "yolo" ? "error" : "accent";
		const text = ctx.ui.theme ? ctx.ui.theme.fg(color, badge) : badge;
		ctx.ui.setStatus("1c-permissions", text);
	}

	public async handleToolCall(
		event: { toolName: string; input: Record<string, unknown> },
		ctx?: ExtensionContext,
	): Promise<{ block: boolean; reason?: string }> {
		const check = this.policy.checkToolCall(event.toolName, event.input);
		if (check.allowed) {
			return { block: false };
		}

		if (check.requiresUserConfirmation) {
			if (ctx?.ui && typeof ctx.ui.confirm === "function") {
				const confirmed = await ctx.ui.confirm(
					`[1C Безопасность]: Разрешить вызов инструмента '${event.toolName}'?`,
					check.reason || `Инструмент: ${event.toolName}`,
				);
				if (confirmed) {
					return { block: false };
				}
			}
			return {
				block: true,
				reason: `Вызов '${event.toolName}' заблокирован: действие не подтверждено пользователем (${check.reason || this.policy.getLevel()}).`,
			};
		}

		return { block: true, reason: check.reason || "Действие запрещено политикой безопасности." };
	}

	public register(pi: ExtensionAPI): void {
		pi.registerCommand("permission", {
			description: "Управление политикой подтверждений 1С: /permission [strict | auto-approve | yolo]",
			handler: async (args: string, ctx: ExtensionCommandContext) => {
				const trimmed = args.trim().toLowerCase();
				if (trimmed === "strict" || trimmed === "auto-approve" || trimmed === "yolo") {
					this.setLevel(trimmed as PermissionLevel, ctx);
					ctx.ui.notify(`Политика подтверждений переключена на: ${trimmed.toUpperCase()}`, "info");
				} else {
					const next = this.cycleLevel(ctx);
					ctx.ui.notify(`Текущая политика подтверждений: ${next.toUpperCase()}`, "info");
				}
			},
		});
	}
}
