import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AgentMode, ModeConfig } from "../types.ts";
import { MODE_CONFIGS, MODE_CYCLE_ORDER, MUTATING_TOOLS } from "./types.ts";

export class ModeManager {
	private currentMode: AgentMode;
	private readonly pi: ExtensionAPI;
	private readonly allKnownTools: Set<string>;

	constructor(pi: ExtensionAPI, initialMode: AgentMode = "write") {
		this.pi = pi;
		this.currentMode = initialMode;
		this.allKnownTools = new Set();
	}

	public initializeTools(): void {
		try {
			if (this.pi.getAllTools) {
				for (const t of this.pi.getAllTools()) {
					this.allKnownTools.add(t.name);
				}
			}
			if (this.pi.getActiveTools) {
				for (const t of this.pi.getActiveTools()) {
					this.allKnownTools.add(t);
				}
			}
		} catch {
			// Ignore if not in active session
		}
	}

	public getMode(): AgentMode {
		return this.currentMode;
	}

	public getConfig(): ModeConfig {
		return MODE_CONFIGS[this.currentMode];
	}

	public setMode(mode: AgentMode, ctx?: ExtensionContext): void {
		this.currentMode = mode;
		const config = MODE_CONFIGS[mode];

		// Refresh known tools if available
		if (this.pi.getAllTools) {
			for (const t of this.pi.getAllTools()) {
				this.allKnownTools.add(t.name);
			}
		}
		if (this.pi.getActiveTools) {
			for (const t of this.pi.getActiveTools()) {
				this.allKnownTools.add(t);
			}
		}
		for (const t of config.allowedTools) {
			this.allKnownTools.add(t);
		}

		if (this.pi.setActiveTools) {
			const allowedSet = new Set(config.allowedTools);
			if (config.isReadOnly) {
				const filtered = [...this.allKnownTools].filter((t) => allowedSet.has(t));
				this.pi.setActiveTools(filtered.length > 0 ? filtered : [...config.allowedTools]);
			} else {
				// In write mode: restore full toolset
				this.pi.setActiveTools([...this.allKnownTools]);
			}
		}

		this.updateUI(ctx);
	}

	public cycleMode(ctx?: ExtensionContext): AgentMode {
		const currentIndex = MODE_CYCLE_ORDER.indexOf(this.currentMode);
		const nextIndex = (currentIndex + 1) % MODE_CYCLE_ORDER.length;
		const nextMode = MODE_CYCLE_ORDER[nextIndex];
		this.setMode(nextMode, ctx);
		return nextMode;
	}

	public updateUI(ctx?: ExtensionContext): void {
		if (!ctx?.ui) return;
		const config = MODE_CONFIGS[this.currentMode];
		const color = config.isReadOnly ? "warning" : "accent";
		const badge = `[1C: ${config.title}]`;
		const text = ctx.ui.theme ? ctx.ui.theme.fg(color, badge) : badge;
		ctx.ui.setStatus("1c-mode", text);
	}

	public isToolAllowed(toolName: string): boolean {
		const config = MODE_CONFIGS[this.currentMode];
		if (!config.isReadOnly) {
			return true;
		}
		const mutatingSet = new Set<string>(MUTATING_TOOLS);
		return !mutatingSet.has(toolName);
	}

	public checkToolCall(toolName: string): { block: boolean; reason?: string } {
		if (this.isToolAllowed(toolName)) {
			return { block: false };
		}
		const config = MODE_CONFIGS[this.currentMode];
		return {
			block: true,
			reason: `Инструмент '${toolName}' заблокирован в режиме [${config.title}]. Переключите режим на НАПИСАТЬ (alt+m или /mode write) для разрешения изменений.`,
		};
	}

	public getSystemPromptInjection(): string {
		return MODE_CONFIGS[this.currentMode].systemPromptSuffix;
	}
}
