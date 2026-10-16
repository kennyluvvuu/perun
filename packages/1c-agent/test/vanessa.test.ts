import type { ExtensionAPI, ExtensionToolContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { ToolchainResolver } from "../src/toolchain/resolver.ts";
import { buildVanessaArgs, registerVanessaTools, runVanessaCommand } from "../src/vanessa/index.ts";
import { defaultVanessaExecutor } from "../src/vanessa/runner.ts";
import type { VanessaCommandExecutor } from "../src/vanessa/types.ts";

describe("Vanessa Tools (vrunner) Integration", () => {
	// Resolver with no enterprise to test base argument building without platform auto-detection
	const noEnterpriseResolver = {
		resolveVrunner: () => undefined,
		resolveOscript: () => undefined,
		resolveVanessaAutomationEpf: () => undefined,
		resolveOnecEnterprise: () => undefined,
		resolveIbcmd: () => undefined,
		getToolsDir: () => "/nonexistent-dir",
	} as unknown as ToolchainResolver;

	describe("buildVanessaArgs (vrunner 3.0 CLI commands)", () => {
		it("builds init-dev command arguments as vrunner infobase init", () => {
			const result = buildVanessaArgs(
				{
					action: "init-dev",
					src: "./src/cf",
					ibconnection: "/F./build/ib",
					settings: "./autumn-properties.json",
					dbUser: "Admin",
					dbPassword: "secretPassword",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toEqual([
				"infobase",
				"init",
				"--src",
				"./src/cf",
				"--ibconnection",
				"/F./build/ib",
				"--settings",
				"./autumn-properties.json",
				"--db-user",
				"Admin",
				"--db-pwd",
				"secretPassword",
			]);
		});

		it("supports modern action alias infobase-init", () => {
			const result = buildVanessaArgs(
				{
					action: "infobase-init",
					src: "./src/cf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toEqual(["infobase", "init", "--src", "./src/cf", "--ibconnection", "/F./build/ib"]);
		});

		it("builds load command arguments as vrunner cf load with positional source", () => {
			const result = buildVanessaArgs(
				{
					action: "load",
					src: "./src/edt",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toEqual(["cf", "load", "--ibconnection", "/F./build/ib", "./src/edt"]);
		});

		it("builds dump command arguments as vrunner cf decompile with positional output directory", () => {
			const result = buildVanessaArgs(
				{
					action: "dump",
					src: "./src/edt",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toEqual(["cf", "decompile", "--ibconnection", "/F./build/ib", "./src/edt"]);
		});

		it("builds updatedb command arguments as vrunner infobase update with optional src", () => {
			const result = buildVanessaArgs(
				{
					action: "updatedb",
					src: "./src/cf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toEqual(["infobase", "update", "--src", "./src/cf", "--ibconnection", "/F./build/ib"]);
		});

		it("builds test command arguments with Vanessa Automation epf as vrunner test vanessa", () => {
			const result = buildVanessaArgs(
				{
					action: "test",
					features: "./features",
					vanessaPath: "/tools/vanessa/vanessa-automation.epf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toEqual([
				"test",
				"vanessa",
				"--feature-path",
				"./features",
				"--bddrunner-path",
				"/tools/vanessa/vanessa-automation.epf",
				"--ibconnection",
				"/F./build/ib",
			]);
		});

		it("builds xunit command arguments with epf as vrunner test xunit (vrunner 3.x default)", () => {
			const result = buildVanessaArgs(
				{
					action: "xunit",
					epf: "./build/ТестыMiniCRM.epf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			const expected = ["test", "xunit", "--ibconnection", "/F./build/ib"];
			if (process.platform === "darwin") expected.push("--ordinaryapp");
			expected.push("./build/ТестыMiniCRM.epf");
			expect(result.args).toEqual(expected);
		});

		it("supports legacy vrunner 2.x xunit command arguments", () => {
			const v2Resolver = {
				...noEnterpriseResolver,
				resolveVrunnerVersion: () => "2.10.5",
			} as unknown as ToolchainResolver;

			const result = buildVanessaArgs(
				{
					action: "xunit",
					epf: "./build/ТестыMiniCRM.epf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				v2Resolver,
			);

			const expected = ["xunit", "--ibconnection", "/F./build/ib"];
			if (process.platform === "darwin") expected.push("--ordinaryapp");
			expected.push("./build/ТестыMiniCRM.epf");
			expect(result.args).toEqual(expected);
		});

		it("supports action alias test-xunit with epf", () => {
			const result = buildVanessaArgs(
				{
					action: "test-xunit",
					epf: "./build/ТестыMiniCRM.epf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			const expected = ["test", "xunit", "--ibconnection", "/F./build/ib"];
			if (process.platform === "darwin") expected.push("--ordinaryapp");
			expected.push("./build/ТестыMiniCRM.epf");
			expect(result.args).toEqual(expected);
		});

		it("builds run and run-epf command arguments with epf as vrunner run enterprise in 3.x", () => {
			const result = buildVanessaArgs(
				{
					action: "run",
					epf: "./build/ТестыMiniCRM.epf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				noEnterpriseResolver,
			);

			const expected = [
				"run",
				"enterprise",
				"--execute",
				"./build/ТестыMiniCRM.epf",
				"--ibconnection",
				"/F./build/ib",
			];
			if (process.platform === "darwin") expected.push("--ordinaryapp");
			expect(result.args).toEqual(expected);
		});

		it("builds run command arguments in legacy vrunner 2.x mode", () => {
			const v2Resolver = {
				...noEnterpriseResolver,
				resolveVrunnerVersion: () => "2.9.0",
			} as unknown as ToolchainResolver;

			const result = buildVanessaArgs(
				{
					action: "run",
					epf: "./build/ТестыMiniCRM.epf",
					ibconnection: "/F./build/ib",
				},
				undefined,
				v2Resolver,
			);

			const expected = ["run", "--ibconnection", "/F./build/ib"];
			if (process.platform === "darwin") expected.push("--ordinaryapp");
			expected.push("./build/ТестыMiniCRM.epf");
			expect(result.args).toEqual(expected);
		});

		it("appends additionalArgs when provided", () => {
			const result = buildVanessaArgs(
				{
					action: "init-dev",
					additionalArgs: ["--ordinaryapp", "0", "--workspace", "./build"],
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toEqual(["infobase", "init", "--ordinaryapp", "0", "--workspace", "./build"]);
		});

		it("wraps execution with oscript when vrunner path points to a .os file", () => {
			const result = buildVanessaArgs(
				{
					action: "init-dev",
					vrunnerPath: "/opt/tools/oscript/bin/vrunner.os",
					src: "./src",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args[0]).toBe("/opt/tools/oscript/bin/vrunner.os");
			expect(result.args[1]).toBe("infobase");
			expect(result.args[2]).toBe("init");
			expect(result.args[3]).toBe("--src");
			expect(result.args[4]).toBe("./src");
		});

		it("passes platform --v8version on macOS when 1C Enterprise is resolved", () => {
			const macResolver = {
				resolveVrunner: () => undefined,
				resolveOnecEnterprise: () => "/Applications/1cv8t.localized/8.3.25.1234/1cv8t.app/Contents/MacOS/1cv8t",
			} as unknown as ToolchainResolver;

			const result = buildVanessaArgs(
				{
					action: "init-dev",
					src: "./src",
					ibconnection: "/F./build/ib",
				},
				undefined,
				macResolver,
			);

			if (process.platform === "darwin") {
				expect(result.args).toContain("--v8version");
				expect(result.args).toContain("8.3.25.1234");
			}
		});

		it("passes explicit v8version option regardless of platform", () => {
			const result = buildVanessaArgs(
				{
					action: "init-dev",
					src: "./src",
					ibconnection: "/F./build/ib",
					v8version: "8.3.24.1809",
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toContain("--v8version");
			expect(result.args).toContain("8.3.24.1809");
		});

		it("passes explicit ibcmd flag when requested", () => {
			const result = buildVanessaArgs(
				{
					action: "init-dev",
					src: "./src",
					ibconnection: "/F./build/ib",
					ibcmd: true,
				},
				undefined,
				noEnterpriseResolver,
			);

			expect(result.args).toContain("--ibcmd");
		});

		it("does not duplicate --v8version if already in additionalArgs", () => {
			const macResolver = {
				resolveVrunner: () => undefined,
				resolveOnecEnterprise: () => "/Applications/1cv8t.localized/8.3.25.1234/1cv8t.app/Contents/MacOS/1cv8t",
			} as unknown as ToolchainResolver;

			const result = buildVanessaArgs(
				{
					action: "init-dev",
					additionalArgs: ["--v8version", "8.3.20"],
				},
				undefined,
				macResolver,
			);

			const v8versionIndices = result.args.reduce<number[]>((acc, cur, idx) => {
				if (cur === "--v8version") acc.push(idx);
				return acc;
			}, []);
			expect(v8versionIndices.length).toBe(1);
			expect(result.args[v8versionIndices[0] + 1]).toBe("8.3.20");
		});
	});

	describe("defaultVanessaExecutor", () => {
		it("runs actual process and returns stdout, stderr and exitCode", async () => {
			const result = await defaultVanessaExecutor(
				process.execPath,
				["-e", "process.stdout.write('vanessa ok'); process.stderr.write('vanessa warn');"],
				process.cwd(),
			);

			expect(result.exitCode).toBe(0);
			expect(result.stdout).toBe("vanessa ok");
			expect(result.stderr).toBe("vanessa warn");
		});

		it("returns non-zero exitCode for failing process", async () => {
			const result = await defaultVanessaExecutor(
				process.execPath,
				["-e", "process.stderr.write('fatal error'); process.exit(42);"],
				process.cwd(),
			);

			expect(result.exitCode).toBe(42);
			expect(result.stderr).toBe("fatal error");
		});

		it("returns clear error when command binary does not exist", async () => {
			const result = await defaultVanessaExecutor("nonexistent-binary-12345", [], process.cwd());

			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("не найдена в $PATH");
		});
	});

	describe("runVanessaCommand", () => {
		it("executes successfully via mock executor", async () => {
			const mockExecutor: VanessaCommandExecutor = vi.fn(async (_cmd, _args, _cwd) => {
				return {
					stdout: "Информационная база успешно создана\nКонфигурация загружена",
					stderr: "",
					exitCode: 0,
				};
			});

			const result = await runVanessaCommand(
				{
					action: "init-dev",
					src: "./src",
				},
				{
					projectRoot: "/test/project",
					executor: mockExecutor,
					resolver: noEnterpriseResolver,
				},
			);

			expect(result.success).toBe(true);
			expect(result.exitCode).toBe(0);
			expect(result.stdout).toContain("Информационная база успешно создана");
			expect(result.error).toBeUndefined();
			expect(mockExecutor).toHaveBeenCalledTimes(1);
		});

		it("handles non-zero exit code error reporting", async () => {
			const mockExecutor: VanessaCommandExecutor = vi.fn(async () => {
				return {
					stdout: "",
					stderr: "Ошибка: Конфигурация базы данных не соответствует конфигурации",
					exitCode: 1,
				};
			});

			const result = await runVanessaCommand(
				{
					action: "updatedb",
				},
				{
					executor: mockExecutor,
					resolver: noEnterpriseResolver,
				},
			);

			expect(result.success).toBe(false);
			expect(result.exitCode).toBe(1);
			expect(result.stderr).toContain("Ошибка: Конфигурация базы данных");
			expect(result.error).toContain("Ошибка: Конфигурация базы данных");
		});

		it("returns explicit Russian error when vrunner is not found in PATH and no executor passed", async () => {
			const oldPath = process.env.PATH;
			const oldVrunner = process.env.VRUNNER_PATH;
			delete process.env.VRUNNER_PATH;
			process.env.PATH = "";
			try {
				const result = await runVanessaCommand({
					action: "updatedb",
				});
				expect(result.success).toBe(false);
				expect(result.exitCode).toBe(1);
				expect(result.stderr).toContain("Утилита 'vrunner' (Vanessa Runner) не найдена в $PATH");
				expect(result.error).toContain("Утилита 'vrunner' (Vanessa Runner) не найдена в $PATH");
			} finally {
				process.env.PATH = oldPath;
				if (oldVrunner !== undefined) process.env.VRUNNER_PATH = oldVrunner;
			}
		});
	});

	describe("registerVanessaTools (Tool registration & execution)", () => {
		it("registers 1c_vanessa tool and executes correctly", async () => {
			let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
			const mockPi = {
				registerTool: vi.fn((tool) => {
					registeredTool = tool;
				}),
			} as unknown as ExtensionAPI;

			const mockExecutor: VanessaCommandExecutor = vi.fn(async () => {
				return {
					stdout: "BDD сценарии успешно пройдены: 12 сценариев, 0 ошибок",
					stderr: "",
					exitCode: 0,
				};
			});

			registerVanessaTools(mockPi, "/test/project", mockExecutor);

			expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
			expect(registeredTool).toBeDefined();
			if (!registeredTool) throw new Error("not registered");
			expect(registeredTool.name).toBe("1c_vanessa");
			expect(registeredTool.promptSnippet).toContain("1c_vanessa");

			const mockCtx = { cwd: "/test/custom-cwd" } as ExtensionToolContext;
			const toolResult = await registeredTool.execute(
				"call_1",
				{
					action: "test",
					features: "./features",
				},
				undefined,
				undefined,
				mockCtx,
			);

			expect(toolResult.isError).toBe(false);
			const text0 = toolResult.content[0];
			if (text0.type !== "text") throw new Error("expected text content");
			expect(text0.text).toContain("[Vanessa Tools: TEST]");
			expect(text0.text).toContain("Статус: УСПЕШНО");
			expect(text0.text).toContain("BDD сценарии успешно пройдены");
			expect(mockExecutor).toHaveBeenCalledWith(
				expect.any(String),
				expect.any(Array),
				"/test/custom-cwd",
				undefined,
				expect.any(Object),
			);
		});

		it("returns error result on execution failure and reports signal abortion correctly", async () => {
			let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
			const mockPi = {
				registerTool: vi.fn((tool) => {
					registeredTool = tool;
				}),
			} as unknown as ExtensionAPI;

			const mockExecutor: VanessaCommandExecutor = vi.fn(async () => {
				return {
					stdout: "",
					stderr: "Процесс завершен сигналом SIGKILL",
					exitCode: null,
				};
			});

			registerVanessaTools(mockPi, "/test/project", mockExecutor);

			expect(registeredTool).toBeDefined();
			if (!registeredTool) throw new Error("not registered");

			const mockCtx = {} as ExtensionToolContext;
			const toolResult = await registeredTool.execute(
				"call_2",
				{
					action: "load",
					src: "./missing_src",
				},
				undefined,
				undefined,
				mockCtx,
			);

			expect(toolResult.isError).toBe(true);
			const text0 = toolResult.content[0];
			if (text0.type !== "text") throw new Error("expected text content");
			expect(text0.text).toContain("[Vanessa Tools: LOAD]");
			expect(text0.text).toContain("Статус: ОШИБКА");
			expect(text0.text).toContain("код возврата: прервано/сигнал");
			expect(text0.text).not.toContain("код возврата: 0");
		});

		it("accepts xunit action in tool registration schema and executes xunit test", async () => {
			let registeredTool: Parameters<ExtensionAPI["registerTool"]>[0] | undefined;
			const mockPi = {
				registerTool: vi.fn((tool) => {
					registeredTool = tool;
				}),
			} as unknown as ExtensionAPI;

			const mockExecutor: VanessaCommandExecutor = vi.fn(async () => {
				return {
					stdout: "xUnit тесты пройдены: 10 тестов, 0 ошибок",
					stderr: "",
					exitCode: 0,
				};
			});

			registerVanessaTools(mockPi, "/test/project", mockExecutor);

			expect(registeredTool).toBeDefined();
			if (!registeredTool) throw new Error("not registered");

			const paramsSchema = registeredTool.parameters as unknown as {
				properties: {
					action: { anyOf: Array<{ const?: string }> };
					epf?: unknown;
				};
			};
			const actions = paramsSchema.properties.action.anyOf.map((literal) => literal.const);
			expect(actions).toEqual(["test", "xunit"]);
			expect(paramsSchema.properties.epf).toBeDefined();

			const mockCtx = { cwd: "/test/custom-cwd" } as ExtensionToolContext;
			const toolResult = await registeredTool.execute(
				"call_xunit",
				{
					action: "xunit",
					epf: "./build/ТестыMiniCRM.epf",
				},
				undefined,
				undefined,
				mockCtx,
			);

			expect(toolResult.isError).toBe(false);
			const text0 = toolResult.content[0];
			if (text0.type !== "text") throw new Error("expected text content");
			expect(text0.text).toContain("[Vanessa Tools: XUNIT]");
			expect(text0.text).toContain("Статус: УСПЕШНО");
			expect(text0.text).toContain("xUnit тесты пройдены");
			expect(mockExecutor).toHaveBeenCalledWith(
				expect.any(String),
				expect.arrayContaining([
					"xunit",
					"./build/ТестыMiniCRM.epf",
					"--ibconnection",
					"/F/test/custom-cwd/build/ib",
				]),
				"/test/custom-cwd",
				undefined,
				expect.any(Object),
			);
		});
	});
});
