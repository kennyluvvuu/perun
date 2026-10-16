// Конфигурация режимов агента 1С: перечни инструментов чтения и изменения, инструкции и порядок переключения.

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
	"1c_git_blame_context",
	"1c_docs_search",
	"1c_docs_read",
	"1c_docs_write",
	"1c_docs_outdated",
	"1c_md",
	"1c_ib",
] as const;

export const MUTATING_TOOLS = ["edit", "write", "bash", "bsl_fix_standards", "1c_vanessa", "1c_git_docgen"] as const;

export const ACTION_GATED_TOOLS = ["1c_md", "1c_ib"] as const;

const WRITE_TOOLS = [...READ_ONLY_TOOLS, ...MUTATING_TOOLS];

export const MODE_CONFIGS: Record<AgentMode, ModeConfig> = {
	find: {
		name: "find",
		title: "НАЙТИ",
		description: "Навигация, поиск определений, анализ вызовов и связей подсистем (read-only)",
		allowedTools: READ_ONLY_TOOLS,
		isReadOnly: true,
		systemPromptSuffix: MODE_PROMPTS.find,
	},
	explain: {
		name: "explain",
		title: "ОБЪЯСНИТЬ",
		description: "Объяснение бизнес-логики BSL, стандарты BSLDoc/ИТС, диаграммы Mermaid (read-only)",
		allowedTools: READ_ONLY_TOOLS,
		isReadOnly: true,
		systemPromptSuffix: MODE_PROMPTS.explain,
	},
	write: {
		name: "write",
		title: "НАПИСАТЬ",
		description: "Написание и редактирование кода BSL и метаданных EDT, сборка в базу (полный доступ)",
		allowedTools: WRITE_TOOLS,
		isReadOnly: false,
		systemPromptSuffix: MODE_PROMPTS.write,
	},
	plan: {
		name: "plan",
		title: "ПЛАНИРОВАТЬ",
		description: "Декомпозиция задач, проектирование архитектуры метаданных (read-only)",
		allowedTools: READ_ONLY_TOOLS,
		isReadOnly: true,
		systemPromptSuffix: MODE_PROMPTS.plan,
	},
};

export const MODE_CYCLE_ORDER: readonly AgentMode[] = ["find", "explain", "write", "plan"] as const;
