import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveSkillsDir } from "../toolchain/index.ts";

export interface SkillToolParams {
	skill: string;
	args?: Record<string, unknown> | string[];
	cwd?: string;
}

export interface SkillExecutionResult {
	success: boolean;
	skill: string;
	scriptPath: string;
	command: string;
	args: string[];
	exitCode: number | null;
	signalCode?: string | null;
	stdout: string;
	stderr: string;
	error?: string;
	durationMs: number;
	artifactValidation?: {
		valid: boolean;
		reason?: string;
		outputPath?: string;
	};
}

export type SkillCommandExecutor = (
	command: string,
	args: string[],
	cwd: string,
	signal?: AbortSignal,
	env?: Record<string, string | undefined>,
) => Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signalCode?: string | null;
	error?: string;
}>;

export function resolveSkillScript(skillsDir: string, skill: string): string | undefined {
	if (!skillsDir || !skill) {
		return undefined;
	}

	// 1. Direct path (absolute or relative to current dir)
	if (path.isAbsolute(skill) && fs.existsSync(skill) && fs.statSync(skill).isFile()) {
		return skill;
	}

	// 2. Relative inside skillsDir
	const directInSkills = path.join(skillsDir, skill);
	if (fs.existsSync(directInSkills) && fs.statSync(directInSkills).isFile()) {
		return directInSkills;
	}

	// 3. Inside skills/<skill>/scripts/<skill>.(py|os)
	const candidatePy = path.join(skillsDir, skill, "scripts", `${skill}.py`);
	if (fs.existsSync(candidatePy)) {
		return candidatePy;
	}
	const candidateOs = path.join(skillsDir, skill, "scripts", `${skill}.os`);
	if (fs.existsSync(candidateOs)) {
		return candidateOs;
	}

	// 4. Any .py or .os in skills/<skill>/scripts/
	const skillScriptsDir = path.join(skillsDir, skill, "scripts");
	if (fs.existsSync(skillScriptsDir) && fs.statSync(skillScriptsDir).isDirectory()) {
		try {
			const entries = fs.readdirSync(skillScriptsDir);
			const pyOrOs = entries.filter((e) => e.endsWith(".py") || e.endsWith(".os"));
			if (pyOrOs.length > 0) {
				const match = pyOrOs.find((e) => e.startsWith(skill)) || pyOrOs[0];
				return path.join(skillScriptsDir, match);
			}
		} catch {}
	}

	// 5. In skills/<skill>/<skill>.(py|os)
	const inFolderPy = path.join(skillsDir, skill, `${skill}.py`);
	if (fs.existsSync(inFolderPy)) {
		return inFolderPy;
	}
	const inFolderOs = path.join(skillsDir, skill, `${skill}.os`);
	if (fs.existsSync(inFolderOs)) {
		return inFolderOs;
	}

	// 6. Direct script lookup across subdirectories by filename
	if (skill.endsWith(".py") || skill.endsWith(".os")) {
		const base = path.basename(skill, path.extname(skill));
		const candidate = path.join(skillsDir, base, "scripts", skill);
		if (fs.existsSync(candidate)) {
			return candidate;
		}
	}

	return undefined;
}

export function buildSkillArgs(args?: Record<string, unknown> | string[]): string[] {
	if (!args) {
		return [];
	}
	if (Array.isArray(args)) {
		return args.map((a) => String(a));
	}
	const result: string[] = [];
	for (const [key, value] of Object.entries(args)) {
		if (value === undefined || value === null) {
			continue;
		}
		const flag = key.startsWith("-") ? key : `-${key}`;
		if (typeof value === "boolean") {
			if (value) {
				result.push(flag);
			}
		} else if (Array.isArray(value)) {
			for (const item of value) {
				result.push(flag, String(item));
			}
		} else {
			result.push(flag, String(value));
		}
	}
	return result;
}

export function extractOutputPath(args?: Record<string, unknown> | string[]): string | undefined {
	if (!args) {
		return undefined;
	}
	if (!Array.isArray(args)) {
		for (const [key, value] of Object.entries(args)) {
			const cleanKey = key.replace(/^-+/, "").toLowerCase();
			if (cleanKey === "outputpath" || cleanKey === "output") {
				return typeof value === "string" ? value : undefined;
			}
		}
		return undefined;
	}
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		const clean = arg.replace(/^-+/, "").toLowerCase();
		if ((clean === "outputpath" || clean === "output") && i + 1 < args.length) {
			return args[i + 1];
		}
		if (clean.startsWith("outputpath=") || clean.startsWith("output=")) {
			return arg.slice(arg.indexOf("=") + 1);
		}
	}
	return undefined;
}

export function validateFormArtifact(xmlContent: string): { valid: boolean; reason?: string } {
	if (/<ChildItems\s*\/>/.test(xmlContent)) {
		return { valid: false, reason: "тег <ChildItems/> пуст (self-closing)" };
	}
	if (/<ChildItems>\s*<\/ChildItems>/.test(xmlContent)) {
		return { valid: false, reason: "тег <ChildItems></ChildItems> пуст (нет дочерних элементов)" };
	}
	if (!/<ChildItems>[\s\S]+?<\/ChildItems>/.test(xmlContent)) {
		return { valid: false, reason: "тег <ChildItems> отсутствует в Form.xml" };
	}
	return { valid: true };
}

export const defaultSkillExecutor: SkillCommandExecutor = async (
	command: string,
	args: string[],
	cwd: string,
	signal?: AbortSignal,
	env?: Record<string, string | undefined>,
): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signalCode?: string | null;
	error?: string;
}> => {
	return new Promise((resolve) => {
		let stdout = "";
		let stderr = "";

		const proc = child_process.spawn(command, args, {
			cwd,
			signal,
			env: {
				...process.env,
				...env,
			},
			stdio: ["ignore", "pipe", "pipe"],
		});

		proc.stdout.on("data", (data: Buffer) => {
			stdout += data.toString("utf8");
		});

		proc.stderr.on("data", (data: Buffer) => {
			stderr += data.toString("utf8");
		});

		proc.on("error", (err: Error) => {
			resolve({
				stdout,
				stderr,
				exitCode: 1,
				error: err.message,
			});
		});

		proc.on("close", (code: number | null, sig: NodeJS.Signals | null) => {
			resolve({
				stdout,
				stderr,
				exitCode: code,
				signalCode: sig ? String(sig) : null,
			});
		});
	});
};

export async function runSkill(
	params: SkillToolParams,
	options: {
		projectRoot?: string;
		skillsDir?: string;
		signal?: AbortSignal;
		executor?: SkillCommandExecutor;
	} = {},
): Promise<SkillExecutionResult> {
	const startTime = Date.now();
	const skillsDir = options.skillsDir || resolveSkillsDir();
	const scriptPath = resolveSkillScript(skillsDir, params.skill);
	const cwd = params.cwd || options.projectRoot || process.cwd();

	if (!scriptPath) {
		const durationMs = Date.now() - startTime;
		return {
			success: false,
			skill: params.skill,
			scriptPath: "",
			command: "",
			args: [],
			exitCode: 1,
			stdout: "",
			stderr: `Скрипт навыка '${params.skill}' не найден в каталоге ${skillsDir}`,
			error: `Skill script '${params.skill}' not found`,
			durationMs,
		};
	}

	const ext = path.extname(scriptPath).toLowerCase();
	const command = ext === ".os" ? process.env.OSCRIPT_PATH || "oscript" : process.env.PYTHON_PATH || "python3";

	const skillArgs = buildSkillArgs(params.args);
	const fullArgs = [scriptPath, ...skillArgs];
	const executor = options.executor || defaultSkillExecutor;

	const execResult = await executor(command, fullArgs, cwd, options.signal);
	const durationMs = Date.now() - startTime;

	let success = execResult.exitCode === 0 && !execResult.error;
	let artifactValidation: SkillExecutionResult["artifactValidation"] | undefined;

	// Invariant validation for output artifacts (e.g. Form.xml)
	const rawOutputPath = extractOutputPath(params.args);
	if (rawOutputPath) {
		const resolvedOut = path.isAbsolute(rawOutputPath) ? rawOutputPath : path.join(cwd, rawOutputPath);
		if (resolvedOut.endsWith("Form.xml") || resolvedOut.endsWith("form.xml")) {
			if (fs.existsSync(resolvedOut)) {
				try {
					const content = fs.readFileSync(resolvedOut, "utf8");
					const val = validateFormArtifact(content);
					if (!val.valid) {
						success = false;
						try {
							fs.unlinkSync(resolvedOut);
						} catch {}
						artifactValidation = {
							valid: false,
							reason: val.reason,
							outputPath: resolvedOut,
						};
					} else {
						artifactValidation = {
							valid: true,
							outputPath: resolvedOut,
						};
					}
				} catch (err: unknown) {
					success = false;
					artifactValidation = {
						valid: false,
						reason: err instanceof Error ? err.message : String(err),
						outputPath: resolvedOut,
					};
				}
			}
		}
	}

	return {
		success,
		skill: params.skill,
		scriptPath,
		command,
		args: skillArgs,
		exitCode: execResult.exitCode,
		signalCode: execResult.signalCode,
		stdout: execResult.stdout,
		stderr: execResult.stderr,
		error: execResult.error,
		durationMs,
		artifactValidation,
	};
}

export function registerSkillTools(
	pi: ExtensionAPI,
	projectRoot?: string,
	executor?: SkillCommandExecutor,
	skillsDir?: string,
): void {
	pi.registerTool({
		name: "1c_skill_execute",
		label: "1C Skill Executor",
		description:
			"Выполнение специализированных навыков 1С (CC-1C-SKILLS: генерация и редактирование управляемых форм, СКД, MXL, метаданных EDT, XDTO, CFE, EPF) с прямым перехватом stdout/stderr, контролем реального exit code и валидацией артефактов.",
		promptSnippet:
			"1c_skill_execute: запуск встроенных навыков 1С (form-compile, form-add, skd-compile, meta-edit и др.) без шелл-конвейеров",
		parameters: Type.Object({
			skill: Type.String({
				description:
					"Имя навыка 1С (например, 'form-compile', 'form-add', 'skd-compile', 'meta-edit') или путь к скрипту.",
			}),
			args: Type.Optional(
				Type.Union(
					[
						Type.Record(Type.String(), Type.Unknown(), {
							description:
								"Именованные аргументы навыка (объект ключ-значение, например { OutputPath: '...', FromObject: true }).",
						}),
						Type.Array(Type.String(), {
							description:
								"Массив строковых аргументов командной строки (например ['-FromObject', '-Purpose', 'Item']).",
						}),
					],
					{
						description: "Аргументы запуска навыка (массив или объект ключ-значение).",
					},
				),
			),
			cwd: Type.Optional(
				Type.String({
					description: "Рабочая директория для запуска скрипта навыка (по умолчанию корень проекта).",
				}),
			),
		}),
		execute: async (
			_toolCallId: string,
			params: SkillToolParams,
			signal: AbortSignal | undefined,
			_onUpdate: unknown,
			ctx: ExtensionToolContext,
		): Promise<AgentToolResult<unknown>> => {
			const effectiveRoot = params.cwd || ctx?.cwd || projectRoot || process.cwd();
			const result = await runSkill(
				{ ...params, cwd: effectiveRoot },
				{
					projectRoot: effectiveRoot,
					skillsDir,
					signal,
					executor,
				},
			);

			const lines: string[] = [
				`[1C Skill: ${result.skill}]`,
				`Статус: ${result.success ? "УСПЕШНО" : "ОШИБКА"}`,
				`Скрипт: ${result.scriptPath || "(не найден)"}`,
				`Команда: ${result.command} ${result.scriptPath} ${result.args.join(" ")}`.trim(),
				`Код возврата: ${result.exitCode !== null ? result.exitCode : result.signalCode ? `сигнал ${result.signalCode}` : "ошибка процесса"}`,
				`Время выполнения: ${result.durationMs}ms`,
			];

			if (result.stdout.trim()) {
				lines.push("\n--- Стандартный вывод (stdout) ---");
				lines.push(result.stdout.trim());
			}

			if (result.stderr.trim()) {
				lines.push("\n--- Ошибки (stderr) ---");
				lines.push(result.stderr.trim());
			}

			if (result.error && !result.stderr.includes(result.error)) {
				lines.push(`\nОшибка процесса: ${result.error}`);
			}

			if (result.artifactValidation && !result.artifactValidation.valid) {
				lines.push("\n--- Валидация выходного артефакта ---");
				lines.push(
					`[ERROR] Нарушен инвариант артефакта: ${result.artifactValidation.reason} (${result.artifactValidation.outputPath}). Пустой/невалидный файл удален.`,
				);
			}

			return {
				content: [{ type: "text", text: lines.join("\n") }],
				isError: !result.success,
				details: result,
			};
		},
	});
}
