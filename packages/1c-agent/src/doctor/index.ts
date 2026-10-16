import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import { locateEdtCli } from "../infobase/platform-locator.ts";
import { defaultToolchainResolver, extractOnecVersion, type ToolchainResolver } from "../toolchain/resolver.ts";
import type { DoctorItem, DoctorReport, DoctorRunResult } from "./types.ts";

export * from "./types.ts";

export function tryGetBinaryVersion(binaryPath: string, args: string[] = ["--version"]): string | undefined {
	try {
		const res = spawnSync(binaryPath, args, {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 10000,
		});
		if (res.error) return undefined;
		if (res.status !== 0 && !res.stdout) return undefined;
		const out = (res.stdout || "").trim();
		if (!out) return undefined;
		return out.split(/\r?\n/)[0]?.trim();
	} catch {
		return undefined;
	}
}

export async function checkDoctorToolchain(
	resolver: ToolchainResolver = defaultToolchainResolver,
): Promise<DoctorReport> {
	const items: DoctorItem[] = [];

	// 1. 1C:Enterprise platform (onecEnterprise)
	const onec = resolver.resolveOnecEnterprise();
	if (onec) {
		const version = extractOnecVersion(onec) || tryGetBinaryVersion(onec);
		const details = "Платформа обнаружена и готова для работы с инфобазами и vrunner.";
		let recommendation: string | undefined;

		if (process.platform === "darwin" && !fs.existsSync("/opt/1cv8")) {
			recommendation =
				"Совет для macOS: библиотека vrunner (v8find) по умолчанию ищет платформу 1С в /opt/1cv8. " +
				"Для бесшовной работы vrunner с платформой из /Applications рекомендуется создать симлинк: " +
				"sudo mkdir -p /opt/1cv8 && sudo ln -s /Applications/1cv8t.localized /opt/1cv8/current";
		}

		items.push({
			name: "onecEnterprise",
			title: "Платформа 1С:Предприятие (1cv8 / 1cv8t)",
			required: true,
			status: "ok",
			path: onec,
			version,
			details,
			recommendation,
		});
	} else {
		items.push({
			name: "onecEnterprise",
			title: "Платформа 1С:Предприятие (1cv8 / 1cv8t)",
			required: true,
			status: "missing",
			recommendation:
				"Установите платформу 1С:Предприятие (на macOS в /Applications/1cv8t.localized/ или /Applications/1cv8.localized/, на Linux в /opt/1cv8/) или укажите путь через переменную окружения ONEC_PATH.",
		});
	}

	// 2. bsl-analyzer
	const bslAnalyzer = resolver.resolveBslAnalyzer();
	if (bslAnalyzer) {
		const version = tryGetBinaryVersion(bslAnalyzer);
		items.push({
			name: "bslAnalyzer",
			title: "bsl-analyzer (LSP и статический анализ BSL)",
			required: true,
			status: "ok",
			path: bslAnalyzer,
			version,
			details: "Нативный бинарник bsl-analyzer обнаружен (поддержка LSP и автофикса стандартов ИТС).",
		});
	} else {
		items.push({
			name: "bslAnalyzer",
			title: "bsl-analyzer (LSP и статический анализ BSL)",
			required: true,
			status: "missing",
			recommendation:
				"Поместите бинарник bsl-analyzer в bin/tools/ или $PATH (https://github.com/1c-syntax/bsl-analyzer), либо задайте BSL_ANALYZER_PATH.",
		});
	}

	// 3. vrunner
	const vrunner = resolver.resolveVrunner();
	if (vrunner) {
		const version = tryGetBinaryVersion(vrunner);
		items.push({
			name: "vrunner",
			title: "vrunner (Vanessa Runner)",
			required: true,
			status: "ok",
			path: vrunner,
			version,
			details: "Утилита автоматизации vrunner обнаружена.",
		});
	} else {
		items.push({
			name: "vrunner",
			title: "vrunner (Vanessa Runner)",
			required: true,
			status: "missing",
			recommendation:
				"Установите vanessa-runner через пакетный менеджер OneScript ('opm install vanessa-runner') или укажите путь через VRUNNER_PATH.",
		});
	}

	// 4. oscript
	const oscript = resolver.resolveOscript();
	if (oscript) {
		const version = tryGetBinaryVersion(oscript, ["-v"]) || tryGetBinaryVersion(oscript);
		items.push({
			name: "oscript",
			title: "oscript (Интерпретатор OneScript)",
			required: true,
			status: "ok",
			path: oscript,
			version,
			details: "Интерпретатор OneScript обнаружен.",
		});
	} else {
		items.push({
			name: "oscript",
			title: "oscript (Интерпретатор OneScript)",
			required: true,
			status: "missing",
			recommendation:
				"Установите OneScript 2.0+ с официального сайта (https://oscript.io/) или укажите путь через OSCRIPT_PATH.",
		});
	}

	// 5. vanessaAutomationEpf
	const vanessaEpf = resolver.resolveVanessaAutomationEpf();
	if (vanessaEpf) {
		items.push({
			name: "vanessaAutomationEpf",
			title: "vanessa-automation.epf (BDD-тестирование)",
			required: false,
			status: "ok",
			path: vanessaEpf,
			details: "Внешняя обработка Vanessa Automation найдена.",
		});
	} else {
		items.push({
			name: "vanessaAutomationEpf",
			title: "vanessa-automation.epf (BDD-тестирование)",
			required: false,
			status: "warning",
			recommendation:
				"Поместите vanessa-automation.epf в каталог tools/vanessa/ или укажите путь через VANESSA_AUTOMATION_EPF / VANESSA_AUTOMATION_PATH.",
		});
	}

	// 6. ibcmd
	const ibcmd = resolver.resolveIbcmd();
	if (ibcmd) {
		items.push({
			name: "ibcmd",
			title: "ibcmd (Утилита командной строки 1С)",
			required: false,
			status: "ok",
			path: ibcmd,
			details: "Утилита командной строки ibcmd обнаружена.",
		});
	} else {
		items.push({
			name: "ibcmd",
			title: "ibcmd (Утилита командной строки 1С)",
			required: false,
			status: "info",
			details: "Не найдена (опционально, доступна в составе платформы 1С:Предприятие 8.3.14+).",
		});
	}

	// 7. 1C:EDT CLI
	const edtCli = locateEdtCli();
	if (edtCli) {
		items.push({
			name: "edtCli",
			title: "1C:EDT CLI (1cedtcli)",
			required: false,
			status: "ok",
			path: edtCli,
			details: "Выгрузка EDT-проекта в XML для сборки в базу доступна (1c_ib build).",
		});
	} else {
		items.push({
			name: "edtCli",
			title: "1C:EDT CLI (1cedtcli)",
			required: false,
			status: "warning",
			recommendation:
				"Установите 1C:EDT или укажите путь к 1cedtcli в EDTCLI_PATH: без него проект EDT нельзя собрать в базу (1c_ib build).",
		});
	}

	// 8. tools directory
	const toolsDir = resolver.getToolsDir();
	if (fs.existsSync(toolsDir)) {
		items.push({
			name: "toolsDir",
			title: "Каталог встроенных инструментов (tools)",
			required: false,
			status: "ok",
			path: toolsDir,
			details: "Каталог встроенных инструментов доступен.",
		});
	} else {
		items.push({
			name: "toolsDir",
			title: "Каталог встроенных инструментов (tools)",
			required: false,
			status: "info",
			details: `Каталог ${toolsDir} отсутствует (не критично, если инструменты доступны в $PATH).`,
		});
	}

	const missingRequired = items.filter((i) => i.required && i.status === "missing");
	const requiredOk = missingRequired.length === 0;
	const allOk = items.every((i) => i.status === "ok");

	let summary = "";
	if (requiredOk) {
		summary = "Все обязательные инструменты установлены и готовы к работе.";
	} else {
		const names = missingRequired.map((i) => i.name).join(", ");
		summary = `Обнаружены отсутствующие обязательные инструменты: ${names}.`;
	}

	return {
		allOk,
		requiredOk,
		items,
		summary,
	};
}

export function formatDoctorReport(report: DoctorReport): string {
	const lines: string[] = ["=== ПерУН Doctor: Диагностика тулчейна 1С ===", ""];

	for (let i = 0; i < report.items.length; i++) {
		const item = report.items[i];
		const statusTag = `[${item.status.toUpperCase()}]`;
		lines.push(`${i + 1}. ${item.title}`);
		lines.push(`   Статус: ${statusTag}`);
		if (item.path) {
			lines.push(`   Путь:   ${item.path}`);
		}
		if (item.version) {
			lines.push(`   Версия: ${item.version}`);
		}
		if (item.details) {
			lines.push(`   Инфо:   ${item.details}`);
		}
		if (item.recommendation) {
			lines.push(`   Совет:  ${item.recommendation}`);
		}
		lines.push("");
	}

	lines.push("------------------------------------------------------------");
	lines.push(`ИТОГ: ${report.summary}`);
	if (!report.requiredOk) {
		lines.push("Для полной функциональности ПерУН установите недостающие инструменты.");
	}

	return lines.join("\n");
}

export async function runDoctor(resolver: ToolchainResolver = defaultToolchainResolver): Promise<DoctorRunResult> {
	const report = await checkDoctorToolchain(resolver);
	const output = formatDoctorReport(report);
	const exitCode = report.requiredOk ? 0 : 1;
	return {
		exitCode,
		output,
		report,
	};
}

export interface RunDoctorCliOptions {
	readonly stdout?: (data: string) => void;
	readonly stderr?: (data: string) => void;
	readonly exit?: (code: number) => void;
}

export async function handleDoctorCli(
	args: string[],
	options?: RunDoctorCliOptions,
	resolver: ToolchainResolver = defaultToolchainResolver,
): Promise<boolean> {
	if (args.includes("--doctor") || args.includes("doctor")) {
		const result = await runDoctor(resolver);
		const writeOut = options?.stdout || ((msg: string) => process.stdout.write(`${msg}\n`));
		writeOut(result.output);
		const exitFn = options?.exit || ((code: number) => process.exit(code));
		exitFn(result.exitCode);
		return true;
	}
	return false;
}
