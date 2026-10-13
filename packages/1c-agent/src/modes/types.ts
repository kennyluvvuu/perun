import type { AgentMode, ModeConfig } from "../types.ts";
import { MODE_PROMPTS } from "./prompts.ts";

export const READ_ONLY_TOOLS = [
	"read",
	"find",
	"grep",
	"ls",
	"1c_call_hierarchy",
	"1c_impact_analysis",
	"1c_ast_symbols",
] as const;

export const MUTATING_TOOLS = ["edit", "write", "bsl_fix_standards"] as const;

export const MODE_CONFIGS: Record<AgentMode, ModeConfig> = {
	find: {
		name: "find",
		title: "НАЙТИ",
		description: "Навигация, поиск определений, анализ вызовов и связей подсистем (read-only)",
		allowedTools: ["read", "find", "grep", "ls", "1c_call_hierarchy", "1c_impact_analysis", "1c_ast_symbols"],
		isReadOnly: true,
		systemPromptSuffix: MODE_PROMPTS.find,
	},
	explain: {
		name: "explain",
		title: "ОБЪЯСНИТЬ",
		description: "Объяснение бизнес-логики BSL, стандарты BSLDoc/ИТС, диаграммы Mermaid (read-only)",
		allowedTools: ["read", "find", "grep", "ls", "1c_impact_analysis", "1c_ast_symbols"],
		isReadOnly: true,
		systemPromptSuffix: MODE_PROMPTS.explain,
	},
	write: {
		name: "write",
		title: "НАПИСАТЬ",
		description: "Написание и редактирование кода BSL и метаданных EDT, авто-фикс ИТС (полный доступ)",
		allowedTools: [
			"read",
			"find",
			"grep",
			"ls",
			"edit",
			"write",
			"bsl_fix_standards",
			"1c_call_hierarchy",
			"1c_impact_analysis",
			"1c_ast_symbols",
			"1c_subagent",
		],
		isReadOnly: false,
		systemPromptSuffix: MODE_PROMPTS.write,
	},
	plan: {
		name: "plan",
		title: "ПЛАНИРОВАТЬ",
		description: "Декомпозиция задач, проектирование архитектуры метаданных (read-only)",
		allowedTools: ["read", "find", "grep", "ls", "1c_impact_analysis", "1c_subagent"],
		isReadOnly: true,
		systemPromptSuffix: MODE_PROMPTS.plan,
	},
};

export const MODE_CYCLE_ORDER: readonly AgentMode[] = ["find", "explain", "write", "plan"] as const;
