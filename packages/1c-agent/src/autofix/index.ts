export { generatePatches, generateUnifiedDiff } from "./patcher.ts";
export {
	analyzeCodeForItsRules,
	checkVirtualTableArity,
	extractQueriesFromXml,
	isRuleAutoFixable,
	matchesRuleId,
	normalizeRuleId,
	parseBslAnalyzerJsonOutput,
	parseVirtualTableArgs,
	RULE_ALIASES,
	VIRTUAL_TABLE_PARAM_LIMITS,
} from "./rules.ts";
export { registerAutofixTools } from "./tools.ts";
