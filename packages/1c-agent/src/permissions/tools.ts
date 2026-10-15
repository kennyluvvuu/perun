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

	public getProjectRoot(): string {
		return this.policy.getProjectRoot();
	}

	public getPolicy(): PermissionPolicy {
		return this.policy;
	}

	public async handleToolCall(
		event: { toolName: string; input: Record<string, unknown> },
		ctx?: ExtensionContext,
	): Promise<{ block: boolean; reason?: string }> {
		return this.policy.handleToolCall(event, ctx);
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
