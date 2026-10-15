export { generatePatches, generateUnifiedDiff } from "./patcher.ts";
export {
	analyzeCodeForItsRules,
	isRuleAutoFixable,
	matchesRuleId,
	normalizeRuleId,
	parseBslAnalyzerJsonOutput,
	RULE_ALIASES,
} from "./rules.ts";
export { registerAutofixTools } from "./tools.ts";
