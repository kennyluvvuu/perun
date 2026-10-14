import { describe, expect, it, vi } from "vitest";
import {
	checkDoctorToolchain,
	formatDoctorReport,
	handleDoctorCli,
	runDoctor,
	tryGetBinaryVersion,
} from "../src/doctor/index.ts";
import type { ToolchainResolver } from "../src/toolchain/resolver.ts";

describe("PerUN Doctor (--doctor)", () => {
	it("returns allOk and requiredOk true when all required tools are present", async () => {
		const mockResolver = {
			resolveOnecEnterprise: () => "/Applications/1cv8t.localized/8.3.25.1234/1cv8t.app/Contents/MacOS/1cv8t",
			resolveBslAnalyzer: () => "/usr/local/bin/bsl-analyzer",
			resolveVrunner: () => "/usr/local/bin/vrunner",
			resolveOscript: () => "/usr/local/bin/oscript",
			resolveVanessaAutomationEpf: () => "/tools/vanessa/vanessa-automation.epf",
			resolveIbcmd: () => "/usr/local/bin/ibcmd",
			getToolsDir: () => process.cwd(),
		} as unknown as ToolchainResolver;

		const report = await checkDoctorToolchain(mockResolver);

		expect(report.requiredOk).toBe(true);
		expect(report.summary).toContain("Все обязательные инструменты установлены");
		const onecItem = report.items.find((i) => i.name === "onecEnterprise");
		expect(onecItem?.status).toBe("ok");
		expect(onecItem?.version).toBe("8.3.25.1234");

		const bslItem = report.items.find((i) => i.name === "bslAnalyzer");
		expect(bslItem?.status).toBe("ok");

		const vrunnerItem = report.items.find((i) => i.name === "vrunner");
		expect(vrunnerItem?.status).toBe("ok");
	});

	it("marks missing required tools and sets requiredOk to false", async () => {
		const mockResolver = {
			resolveOnecEnterprise: () => undefined,
			resolveBslAnalyzer: () => undefined,
			resolveVrunner: () => undefined,
			resolveOscript: () => undefined,
			resolveVanessaAutomationEpf: () => undefined,
			resolveIbcmd: () => undefined,
			getToolsDir: () => "/nonexistent-tools",
		} as unknown as ToolchainResolver;

		const report = await checkDoctorToolchain(mockResolver);

		expect(report.requiredOk).toBe(false);
		expect(report.summary).toContain("Обнаружены отсутствующие обязательные инструменты");
		expect(report.summary).toContain("onecEnterprise");
		expect(report.summary).toContain("bslAnalyzer");
		expect(report.summary).toContain("vrunner");
		expect(report.summary).toContain("oscript");

		const onecItem = report.items.find((i) => i.name === "onecEnterprise");
		expect(onecItem?.status).toBe("missing");
		expect(onecItem?.recommendation).toBeDefined();

		const bslItem = report.items.find((i) => i.name === "bslAnalyzer");
		expect(bslItem?.status).toBe("missing");
		expect(bslItem?.recommendation).toBeDefined();
	});

	it("does not fail requiredOk if only optional tool ibcmd or vanessaAutomationEpf is missing", async () => {
		const mockResolver = {
			resolveOnecEnterprise: () => "/Applications/1cv8.localized/8.3.24.1809/1cv8.app/Contents/MacOS/1cv8",
			resolveBslAnalyzer: () => "/usr/local/bin/bsl-analyzer",
			resolveVrunner: () => "/usr/local/bin/vrunner",
			resolveOscript: () => "/usr/local/bin/oscript",
			resolveVanessaAutomationEpf: () => undefined,
			resolveIbcmd: () => undefined,
			getToolsDir: () => process.cwd(),
		} as unknown as ToolchainResolver;

		const report = await checkDoctorToolchain(mockResolver);

		expect(report.requiredOk).toBe(true);
		const ibcmdItem = report.items.find((i) => i.name === "ibcmd");
		expect(ibcmdItem?.status).toBe("info");

		const vanessaItem = report.items.find((i) => i.name === "vanessaAutomationEpf");
		expect(vanessaItem?.status).toBe("warning");
	});

	it("formats readable text report without any emojis", async () => {
		const mockResolver = {
			resolveOnecEnterprise: () => "/Applications/1cv8t.localized/8.3.25.1234/1cv8t.app/Contents/MacOS/1cv8t",
			resolveBslAnalyzer: () => "/usr/local/bin/bsl-analyzer",
			resolveVrunner: () => undefined,
			resolveOscript: () => "/usr/local/bin/oscript",
			resolveVanessaAutomationEpf: () => undefined,
			resolveIbcmd: () => undefined,
			getToolsDir: () => process.cwd(),
		} as unknown as ToolchainResolver;

		const report = await checkDoctorToolchain(mockResolver);
		const formatted = formatDoctorReport(report);

		expect(formatted).toContain("=== ПерУН Doctor: Диагностика тулчейна 1С ===");
		expect(formatted).toContain("[OK]");
		expect(formatted).toContain("[MISSING]");
		expect(formatted).toContain("ИТОГ:");

		// Verify no emojis are present
		const emojiRegex = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/u;
		expect(emojiRegex.test(formatted)).toBe(false);
	});

	it("runDoctor returns exitCode 0 when required tools are present", async () => {
		const mockResolver = {
			resolveOnecEnterprise: () => "/Applications/1cv8t.localized/8.3.25.1234/1cv8t.app/Contents/MacOS/1cv8t",
			resolveBslAnalyzer: () => "/usr/local/bin/bsl-analyzer",
			resolveVrunner: () => "/usr/local/bin/vrunner",
			resolveOscript: () => "/usr/local/bin/oscript",
			resolveVanessaAutomationEpf: () => "/tools/vanessa/vanessa-automation.epf",
			resolveIbcmd: () => undefined,
			getToolsDir: () => process.cwd(),
		} as unknown as ToolchainResolver;

		const result = await runDoctor(mockResolver);

		expect(result.exitCode).toBe(0);
		expect(result.output).toContain("ИТОГ: Все обязательные инструменты установлены");
	});

	it("runDoctor returns exitCode 1 when any required tool is missing", async () => {
		const mockResolver = {
			resolveOnecEnterprise: () => undefined,
			resolveBslAnalyzer: () => "/usr/local/bin/bsl-analyzer",
			resolveVrunner: () => undefined,
			resolveOscript: () => undefined,
			resolveVanessaAutomationEpf: () => undefined,
			resolveIbcmd: () => undefined,
			getToolsDir: () => process.cwd(),
		} as unknown as ToolchainResolver;

		const result = await runDoctor(mockResolver);

		expect(result.exitCode).toBe(1);
		expect(result.output).toContain("ИТОГ: Обнаружены отсутствующие обязательные инструменты");
	});

	it("handleDoctorCli handles --doctor argument correctly", async () => {
		const stdoutMock = vi.fn();
		const exitMock = vi.fn();
		const mockResolver = {
			resolveOnecEnterprise: () => "/Applications/1cv8t.localized/8.3.25.1234/1cv8t.app/Contents/MacOS/1cv8t",
			resolveBslAnalyzer: () => "/usr/local/bin/bsl-analyzer",
			resolveVrunner: () => "/usr/local/bin/vrunner",
			resolveOscript: () => "/usr/local/bin/oscript",
			resolveVanessaAutomationEpf: () => "/tools/vanessa/vanessa-automation.epf",
			resolveIbcmd: () => undefined,
			getToolsDir: () => process.cwd(),
		} as unknown as ToolchainResolver;

		const handled = await handleDoctorCli(
			["--doctor"],
			{
				stdout: stdoutMock,
				exit: exitMock,
			},
			mockResolver,
		);

		expect(handled).toBe(true);
		expect(stdoutMock).toHaveBeenCalledTimes(1);
		const output = stdoutMock.mock.calls[0][0];
		expect(output).toContain("=== ПерУН Doctor: Диагностика тулчейна 1С ===");
		expect(exitMock).toHaveBeenCalledWith(0);
	});

	it("handleDoctorCli handles 'doctor' subcommand argument correctly", async () => {
		const stdoutMock = vi.fn();
		const exitMock = vi.fn();
		const mockResolver = {
			resolveOnecEnterprise: () => undefined,
			resolveBslAnalyzer: () => "/usr/local/bin/bsl-analyzer",
			resolveVrunner: () => undefined,
			resolveOscript: () => undefined,
			resolveVanessaAutomationEpf: () => undefined,
			resolveIbcmd: () => undefined,
			getToolsDir: () => process.cwd(),
		} as unknown as ToolchainResolver;

		const handled = await handleDoctorCli(
			["doctor"],
			{
				stdout: stdoutMock,
				exit: exitMock,
			},
			mockResolver,
		);

		expect(handled).toBe(true);
		expect(stdoutMock).toHaveBeenCalledTimes(1);
		const output = stdoutMock.mock.calls[0][0];
		expect(output).toContain("ИТОГ: Обнаружены отсутствующие обязательные инструменты");
		expect(exitMock).toHaveBeenCalledWith(1);
	});

	it("handleDoctorCli ignores non-doctor arguments and returns false", async () => {
		const stdoutMock = vi.fn();
		const exitMock = vi.fn();

		const handled = await handleDoctorCli(["--model", "claude-3-5-sonnet"], {
			stdout: stdoutMock,
			exit: exitMock,
		});

		expect(handled).toBe(false);
		expect(stdoutMock).not.toHaveBeenCalled();
		expect(exitMock).not.toHaveBeenCalled();
	});

	it("tryGetBinaryVersion returns first line of version output or undefined on failure", () => {
		const nodeVer = tryGetBinaryVersion(process.execPath, ["-v"]);
		expect(nodeVer).toBeDefined();
		expect(nodeVer?.startsWith("v")).toBe(true);

		const nonExistent = tryGetBinaryVersion("/nonexistent/binary/path/12345");
		expect(nonExistent).toBeUndefined();
	});
});
