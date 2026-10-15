import * as fs from "node:fs";
import * as path from "node:path";
import type {
	AgentEndEvent,
	AgentSettledEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
	SessionStartEvent,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from "@earendil-works/pi-coding-agent";
import { registerAutofixTools } from "./autofix/index.ts";
import { runDoctor } from "./doctor/index.ts";
import { generateDocsForDiff, registerGitTools } from "./git/index.ts";
import { BslLspClient, InlineFeedbackHandler } from "./lsp/index.ts";
import { ModeManager } from "./modes/index.ts";
import { registerNavigatorTools } from "./navigator/index.ts";
import { PerunNotifyClient } from "./notify/index.ts";
import { PermissionManager } from "./permissions/index.ts";
import { registerSkillTools } from "./skills/index.ts";
import { registerSubagentTools } from "./subagents/index.ts";
import { resolveSkillsDir } from "./toolchain/index.ts";
import type { AgentMode } from "./types.ts";
import { registerVanessaTools } from "./vanessa/index.ts";

export * from "./autofix/index.ts";
export * from "./doctor/index.ts";
export * from "./git/index.ts";
export * from "./lsp/index.ts";
export * from "./modes/index.ts";
export * from "./navigator/index.ts";
export * from "./notify/index.ts";
export * from "./permissions/index.ts";
export * from "./skills/index.ts";
export * from "./subagents/index.ts";
export * from "./toolchain/index.ts";
export * from "./types.ts";
export * from "./vanessa/index.ts";

export interface OnecAgentExtensionOptions {
	initialMode?: AgentMode;
	bslAnalyzerPath?: string;
	projectRoot?: string;
}

export function createOnecAgentExtension(options: OnecAgentExtensionOptions = {}) {
	return function onecAgentExtension(pi: ExtensionAPI): {
		modeManager: ModeManager;
		lspClient: BslLspClient;
		inlineFeedback: InlineFeedbackHandler;
		permissionManager: PermissionManager;
		notifyClient?: PerunNotifyClient;
	} {
		const projectRoot = options.projectRoot || process.cwd();
		const modeManager = new ModeManager(pi, options.initialMode || "write");
		const lspClient = new BslLspClient({
			executablePath: options.bslAnalyzerPath,
			projectPath: projectRoot,
		});
		const inlineFeedback = new InlineFeedbackHandler(lspClient, {
			bslAnalyzerPath: options.bslAnalyzerPath,
		});
		const permissionManager = new PermissionManager("auto-approve", projectRoot);

		let activeCtx: ExtensionContext | undefined;
		let notifyClient: PerunNotifyClient | undefined;

		const notifyUrl = process.env.PERUN_NOTIFY_URL;
		const notifySecret = process.env.PERUN_NOTIFY_SECRET;
		if (notifyUrl && notifySecret) {
			const notifySession = process.env.PERUN_NOTIFY_SESSION || path.basename(projectRoot);
			notifyClient = new PerunNotifyClient({
				url: notifyUrl,
				secret: notifySecret,
				session: notifySession,
				onError: (message) => {
					if (activeCtx?.mode === "tui" || activeCtx?.mode === "rpc") {
						activeCtx.ui.notify(message, "warning");
					} else {
						process.stderr.write(`[Perun] ${message}\n`);
					}
				},
			});

			permissionManager.setRemoteConfirm((title, message, signal) =>
				notifyClient!.askConfirm(title, message, signal),
			);

			pi.on("agent_end", (event: AgentEndEvent) => {
				const lastAssistant = event.messages
					?.slice()
					.reverse()
					.find((m) => (m as { role?: string })?.role === "assistant");
				notifyClient!.notify({
					type: "agent_end",
					messages: lastAssistant ? [lastAssistant] : [],
				});
			});

			pi.on("agent_settled", (event: AgentSettledEvent) => {
				notifyClient!.notify({
					type: "agent_settled",
					aborted: Boolean(event.aborted),
				});
			});
		}

		// 1. Register tools
		registerNavigatorTools(pi, lspClient, projectRoot);
		registerAutofixTools(pi);
		registerSubagentTools(pi);
		registerVanessaTools(pi, projectRoot);
		registerSkillTools(pi, projectRoot);
		registerGitTools(pi, projectRoot);
		permissionManager.register(pi);

		// 2. Discover built-in 1C skills
		pi.on("resources_discover", () => {
			const skillsDir = resolveSkillsDir();
			if (fs.existsSync(skillsDir)) {
				return { skillPaths: [skillsDir] };
			}
			return undefined;
		});

		// 3. Register /mode command
		pi.registerCommand("mode", {
			description: "Управление режимом агента 1С: /mode [find | explain | write | plan]",
			handler: async (args: string, ctx: ExtensionCommandContext) => {
				const trimmed = args.trim().toLowerCase();
				if (trimmed === "find" || trimmed === "explain" || trimmed === "write" || trimmed === "plan") {
					modeManager.setMode(trimmed as AgentMode, ctx);
					ctx.ui.notify(`Режим агента 1С: ${modeManager.getConfig().title}`, "info");
				} else {
					const next = modeManager.cycleMode(ctx);
					ctx.ui.notify(`Текущий режим 1С: ${modeManager.getConfig().title} (${next})`, "info");
				}
			},
		});

		// 4. Register /doctor command
		pi.registerCommand("doctor", {
			description: "Диагностика тулчейна 1С и проверка наличия необходимых инструментов",
			handler: async (_args: string, ctx: ExtensionCommandContext) => {
				const result = await runDoctor();
				ctx.ui.notify(result.output, result.exitCode === 0 ? "info" : "warning");
			},
		});

		// 5. Register /docgen command
		pi.registerCommand("docgen", {
			description: "Генерация и синхронизация BSLDoc по стандарту ИТС на основе Git diff: /docgen [ref] [--apply]",
			handler: async (args: string, ctx: ExtensionCommandContext) => {
				const parts = args.trim().split(/\s+/).filter(Boolean);
				let targetRef = "HEAD~1";
				let applyChanges = false;
				for (const part of parts) {
					if (part === "--apply" || part === "-a") {
						applyChanges = true;
					} else if (!part.startsWith("-")) {
						targetRef = part;
					}
				}
				ctx.ui.notify(`Анализ Git diff (${targetRef}) и генерация BSLDoc...`, "info");
				const result = await generateDocsForDiff(targetRef, undefined, projectRoot, applyChanges);
				ctx.ui.notify(result.summary, "info");
			},
		});

		// 6. Register alt+m shortcut for mode cycling
		try {
			pi.registerShortcut("alt+m", {
				description: "Циклическое переключение режимов 1С (НАЙТИ -> ОБЪЯСНИТЬ -> НАПИСАТЬ -> ПЛАНИРОВАТЬ)",
				handler: (ctx: ExtensionContext) => {
					modeManager.cycleMode(ctx);
				},
			});
		} catch {
			// Shortcut may already be registered or unsupported in current environment
		}

		// 6. Lifecycle event: session_start
		pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
			activeCtx = ctx;
			modeManager.initializeTools();
			modeManager.updateUI(ctx);
			if (ctx.cwd) {
				permissionManager.getPolicy().setProjectRoot(ctx.cwd);
			}
			permissionManager.updateUI(ctx);

			// Automatically start LSP if 1C files/projects are detected
			const has1cFiles = await detect1cProject(projectRoot);
			if (has1cFiles) {
				await lspClient.start(projectRoot).catch(() => {});
			}
		});

		// 7. Lifecycle event: session_shutdown
		pi.on("session_shutdown", async () => {
			if (notifyClient) {
				await notifyClient.flush().catch(() => {});
			}
			await lspClient.stop().catch(() => {});
		});

		// 8. Hook: before_agent_start - inject mode instructions & 1C environment matrix
		pi.on("before_agent_start", (event: BeforeAgentStartEvent): BeforeAgentStartEventResult | undefined => {
			const promptInjection = modeManager.getSystemPromptInjection();
			const envInjection =
				"ВСТРОЕННОЕ ОКРУЖЕНИЕ, ИНСТРУМЕНТЫ И СУБАГЕНТЫ 1С (ПЕРУН):\n" +
				"- ACTION BIAS (OPENCODE MENTALITY):\n" +
				"  * СТРОГИЙ ЗАПРЕТ НА ЧЕРНОВИКИ В COT: Категорически запрещено генерировать простыни BSL-кода, XML метаданных или diff в мыслях (<think>). Формулируй гипотезу в 1-2 строки и немедленно вызывай инструменты (read, edit, write, grep, find).\n" +
				"  * Не имитируй исполнение в CoT: фоновый bsl-analyzer уже запущен и возвращает inline LSP диагностику прямо в результате edit/write. Ошибки линтера исправляй сразу на следующем шаге.\n" +
				"  * ТУЛЧЕЙН 1С (TOOLCHAIN-RESOLVER): утилиты bsl-analyzer и vanessa-automation.epf поставляются встроенными; vrunner и oscript резолвятся из $PATH или переменных VRUNNER_PATH/OSCRIPT_PATH. Если утилита отсутствует в системе, инструмент вернет понятную ошибку установки. НЕ трать шаги на ручной поиск утилит через bash (which, find, whereis).\n" +
				"  * НАВЫКИ 1С (CC-1C-SKILLS): 82 встроенных специализированных навыка (управляемые формы, 23 типа метаданных, СКД, MXL, роли, EPF/ERF, CFE) доступны агенту.\n" +
				"- СТАНДАРТЫ 1C:EDT И РАЗРАБОТКИ:\n" +
				"  * Формат: проекты 1C:EDT (Configuration.mdo, метаданные .mdo, модули .bsl, .project).\n" +
				"  * ЗАПРЕТ СЛОЖНЫХ XML-ФОРМ: Категорически запрещено вручную создавать сложные файлы форм (Form.form, *.xml, xcf/logform). Платформа 1С:Предприятие 8.3 генерирует автоформы автоматически. Разрабатывай headless-логику в BSL-модулях и тесты YAXUnit.\n" +
				"  * Транзакции и блокировки: БлокировкаДанных перед чтением остатков; в ОбработкаПроведения транзакция открыта (Отказ = Истина;); параметры виртуальных таблиц регистров (запрет фильтрации через ГДЕ); запрет запросов в цикле (QueryInLoop).\n" +
				"- Матрица специализированных инструментов ПерУН:\n" +
				"  * 1c_vanessa: единый инструмент для работы с Vanessa Tools / vrunner (infobase init, cf load, cf decompile, infobase update, test vanessa). Все операции создания базы, загрузки/выгрузки исходников, обновления БД и BDD-тестирования выполняй через 1c_vanessa.\n" +
				"  * bsl_fix_standards: автоматическое исправление нарушений стандартов ИТС в модулях BSL.\n" +
				"  * 1c_call_hierarchy: анализ графа входящих и исходящих вызовов процедур и функций.\n" +
				"  * 1c_impact_analysis: анализ влияния изменений на регистры и проведение документов.\n" +
				"  * 1c_ast_symbols: быстрое извлечение AST-структуры модуля BSL (процедуры, функции, параметры, директивы компиляции &НаСервере/&НаКлиенте).\n" +
				"  * 1c_git_blame_context: извлечение исторического контекста (git blame, git log -S, автор, дата, номер задачи ТЗ/#) для переменной, метода или строки кода.\n" +
				"  * 1c_git_docgen: инкрементальная генерация и синхронизация документации BSLDoc по стандарту ИТС на основе Git diff (слэш-команда /docgen).\n" +
				"- Субагенты (1c_subagent):\n" +
				"  * Агент МОЖЕТ и ДОЛЖЕН вызывать субагентов через 1c_subagent для декомпозиции и параллельного/изолированного выполнения задач. Доступные роли: 1c-architect (архитектура метаданных), 1c-coder (написание BSL кода), 1c-tester (BDD-тесты Vanessa и YAXUnit), 1c-reviewer (аудит качества и стандартов ИТС).\n" +
				"- БЕЗОПАСНОСТЬ ОКРУЖЕНИЯ, ЯЗЫК И ГРАНИЦЫ ЗАДАЧИ:\n" +
				"  * ПИН ЯЗЫКА ОТВЕТА: Язык ответа обязан строго соответствовать языку пользовательского запроса; переключение языка запрещено (недопустим дрейф на китайский, английский или другие языки при запросе на русском).\n" +
				"  * ГРАНИЦЫ ЗАДАЧИ И АРТЕФАКТА: Явно названный в запросе артефакт (файл, модуль, отчет) является жесткой границей задачи; смежные дефекты оформлять только как предложения, не вносить изменения самостоятельно без прямого указания пользователя.\n" +
				"  * СТРОГИЙ ЗАПРЕТ СКАНИРОВАНИЯ ДИСКА И РЕВЕРС-ИНЖИНИРИНГА: Категорически запрещен тотальный поиск find / по всему диску; поиск файлов разрешен только внутри каталога проекта. Категорически запрещено дизассемблирование и реверс-инжиниринг бинарников платформы и утилит через strings, otool, чтение .res/.hbk.";

			if (event.systemPromptOptions?.sections) {
				event.systemPromptOptions.sections.onec_environment = envInjection;
			}
			if (event.systemPromptOptions?.promptGuidelines) {
				event.systemPromptOptions.promptGuidelines.push(promptInjection);
				return undefined;
			}
			if (event.systemPrompt) {
				return {
					systemPrompt: `${event.systemPrompt}\n\n${envInjection}\n\n${promptInjection}`,
				};
			}
			return undefined;
		});

		// 9. Hook: tool_call - mode isolation & permission system
		pi.on(
			"tool_call",
			async (event: ToolCallEvent, ctx: ExtensionContext): Promise<ToolCallEventResult | undefined> => {
				// A. Mode check (blocks mutating tools in read-only modes)
				const modeCheck = modeManager.checkToolCall(event.toolName);
				if (modeCheck.block) {
					return { block: true, reason: modeCheck.reason };
				}

				// B. Permission check (strict / auto-approve / yolo)
				const permCheck = await permissionManager.handleToolCall(
					{ toolName: event.toolName, input: event.input as Record<string, unknown> },
					ctx,
				);
				if (permCheck.block) {
					return { block: true, reason: permCheck.reason };
				}

				return undefined;
			},
		);

		// 10. Hook: tool_result - inline LSP feedback on write/edit
		pi.on("tool_result", async (event: ToolResultEvent): Promise<ToolResultEventResult | undefined> => {
			if (event.toolName === "write" || event.toolName === "edit") {
				const rawPath =
					(event.input as { path?: string; file_path?: string } | undefined)?.path ||
					(event.input as { path?: string; file_path?: string } | undefined)?.file_path;
				if (rawPath && typeof rawPath === "string" && inlineFeedback.isBslFile(rawPath)) {
					if (!lspClient.isReady()) {
						const has1c = await detect1cProject(projectRoot);
						if (has1c) {
							await lspClient.start(projectRoot).catch(() => {});
						}
					}
				}
			}

			const feedback = await inlineFeedback.handleToolResult(event);
			if (feedback?.content) {
				return {
					content: feedback.content,
				};
			}
			return undefined;
		});

		return {
			modeManager,
			lspClient,
			inlineFeedback,
			permissionManager,
			notifyClient,
		};
	};
}

async function checkDirectory(currentDir: string, currentDepth: number, maxDepth: number): Promise<boolean> {
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
	} catch {
		return false;
	}

	const skipDirs = new Set([".git", "node_modules", "dist", ".idea", ".vscode", "bin", "build"]);
	const subdirs: string[] = [];

	for (const entry of entries) {
		const lower = entry.name.toLowerCase();

		if (entry.isFile() || entry.isSymbolicLink()) {
			if (
				lower.endsWith(".bsl") ||
				lower.endsWith(".os") ||
				lower === "configuration.mdo" ||
				lower === "configuration.xml" ||
				lower === "bsl-analyzer.toml" ||
				lower === ".project"
			) {
				return true;
			}
		} else if (entry.isDirectory()) {
			if (!skipDirs.has(lower) && currentDepth < maxDepth) {
				subdirs.push(path.join(currentDir, entry.name));
			}
		}
	}

	for (const subdir of subdirs) {
		const found = await checkDirectory(subdir, currentDepth + 1, maxDepth);
		if (found) {
			return true;
		}
	}

	return false;
}

export async function detect1cProject(directory: string, maxDepth = 2): Promise<boolean> {
	try {
		return await checkDirectory(directory, 0, maxDepth);
	} catch {
		return false;
	}
}

export default createOnecAgentExtension();
