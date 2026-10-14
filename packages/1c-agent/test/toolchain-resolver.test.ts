import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	compareVersionStrings,
	extractOnecVersion,
	getAllToolchainPaths,
	getPerunBinDir,
	getPerunPackageDir,
	resolveBslAnalyzerPath,
	resolveIbcmdPath,
	resolveOscriptPath,
	resolveSkillsDir,
	resolveToolsDir,
	resolveVanessaAutomationPath,
	resolveVrunnerPath,
} from "../src/toolchain/resolver.ts";

describe("Toolchain Resolver", () => {
	const originalEnv = { ...process.env };
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "perun-toolchain-test-"));
	});

	afterEach(() => {
		process.env = { ...originalEnv };
		try {
			fs.rmSync(tempDir, { recursive: true, force: true });
		} catch {}
	});

	describe("Directory resolvers", () => {
		it("resolves package and bin directory", () => {
			const pkgDir = getPerunPackageDir();
			const binDir = getPerunBinDir();

			expect(pkgDir).toBeDefined();
			expect(typeof pkgDir).toBe("string");
			expect(binDir).toBeDefined();
			expect(typeof binDir).toBe("string");
		});

		it("respects PERUN_TOOLS_DIR environment variable", () => {
			const customTools = path.join(tempDir, "custom-tools");
			fs.mkdirSync(customTools, { recursive: true });
			process.env.PERUN_TOOLS_DIR = customTools;

			expect(resolveToolsDir()).toBe(customTools);
		});

		it("respects PERUN_SKILLS_DIR environment variable", () => {
			const customSkills = path.join(tempDir, "custom-skills");
			fs.mkdirSync(customSkills, { recursive: true });
			process.env.PERUN_SKILLS_DIR = customSkills;

			expect(resolveSkillsDir()).toBe(customSkills);
		});
	});

	describe("Utility resolution", () => {
		it("resolves bsl-analyzer custom path and environment variable", () => {
			expect(resolveBslAnalyzerPath("/custom/bsl-analyzer")).toBe("/custom/bsl-analyzer");

			process.env.BSL_ANALYZER_PATH = "/env/bsl-analyzer";
			expect(resolveBslAnalyzerPath()).toBe("/env/bsl-analyzer");
		});

		it("resolves oscript custom path and environment variable", () => {
			expect(resolveOscriptPath("/custom/oscript")).toBe("/custom/oscript");

			process.env.OSCRIPT_PATH = "/env/oscript";
			expect(resolveOscriptPath()).toBe("/env/oscript");
		});

		it("resolves vrunner custom path and environment variable", () => {
			expect(resolveVrunnerPath("/custom/vrunner")).toBe("/custom/vrunner");

			process.env.VRUNNER_PATH = "/env/vrunner";
			expect(resolveVrunnerPath()).toBe("/env/vrunner");
		});

		it("resolves vanessa-automation custom path and environment variable", () => {
			expect(resolveVanessaAutomationPath("/custom/vanessa.epf")).toBe("/custom/vanessa.epf");

			process.env.VANESSA_AUTOMATION_PATH = "/env/vanessa.epf";
			expect(resolveVanessaAutomationPath()).toBe("/env/vanessa.epf");
		});

		it("resolves vanessa-automation from projectRoot when not in environment or toolsDir", () => {
			delete process.env.VANESSA_AUTOMATION_PATH;
			const projectDir = path.join(tempDir, "project");
			const projectVanessaDir = path.join(projectDir, "tools", "vanessa");
			fs.mkdirSync(projectVanessaDir, { recursive: true });
			const projectEpf = path.join(projectVanessaDir, "vanessa-automation.epf");
			fs.writeFileSync(projectEpf, "");

			expect(resolveVanessaAutomationPath(undefined, projectDir)).toBe(projectEpf);
		});

		it("resolves bundled utilities when present in tools directory", () => {
			const mockToolsDir = path.join(tempDir, "tools");
			fs.mkdirSync(mockToolsDir, { recursive: true });
			process.env.PERUN_TOOLS_DIR = mockToolsDir;
			delete process.env.BSL_ANALYZER_PATH;
			delete process.env.VRUNNER_PATH;
			delete process.env.VANESSA_AUTOMATION_PATH;

			const isWin = process.platform === "win32";
			const bslFile = path.join(mockToolsDir, isWin ? "bsl-analyzer.exe" : "bsl-analyzer");
			fs.writeFileSync(bslFile, "");

			const vanessaDir = path.join(mockToolsDir, "vanessa");
			fs.mkdirSync(vanessaDir, { recursive: true });
			const vanessaEpf = path.join(vanessaDir, "vanessa-automation.epf");
			fs.writeFileSync(vanessaEpf, "");

			expect(resolveBslAnalyzerPath()).toBe(bslFile);
			expect(resolveVanessaAutomationPath()).toBe(vanessaEpf);
		});

		it("returns undefined for vrunner and oscript when not installed in toolchain or PATH", () => {
			delete process.env.VRUNNER_PATH;
			delete process.env.OSCRIPT_PATH;
			const oldPath = process.env.PATH;
			process.env.PATH = "";
			try {
				expect(resolveVrunnerPath()).toBeUndefined();
				expect(resolveOscriptPath()).toBeUndefined();
			} finally {
				process.env.PATH = oldPath;
			}
		});

		it("resolves ibcmd custom path and environment variable", () => {
			expect(resolveIbcmdPath("/custom/ibcmd")).toBe("/custom/ibcmd");

			process.env.IBCMD_PATH = "/env/ibcmd";
			expect(resolveIbcmdPath()).toBe("/env/ibcmd");
		});

		it("extracts 1C version from standard platform paths", () => {
			expect(extractOnecVersion("/Applications/1cv8t.localized/8.3.25.1234/1cv8t.app/Contents/MacOS/1cv8t")).toBe(
				"8.3.25.1234",
			);
			expect(extractOnecVersion("/Applications/1cv8.localized/8.3.24.1809/1cv8.app/Contents/MacOS/1cv8")).toBe(
				"8.3.24.1809",
			);
			expect(extractOnecVersion("/opt/1cv8/x86_64/8.3.23.1688/1cv8")).toBe("8.3.23.1688");
			expect(extractOnecVersion("C:\\Program Files\\1cv8\\8.3.22.1709\\bin\\1cv8.exe")).toBe("8.3.22.1709");
			expect(extractOnecVersion("/custom/non-versioned/1cv8")).toBeUndefined();
		});

		it("compares version strings numerically instead of alphabetically", () => {
			expect(compareVersionStrings("8.3.27", "8.3.9")).toBeGreaterThan(0);
			expect(compareVersionStrings("8.3.9", "8.3.27")).toBeLessThan(0);
			expect(compareVersionStrings("8.3.25.1234", "8.3.25.567")).toBeGreaterThan(0);
			expect(compareVersionStrings("8.3.25", "8.3.25")).toBe(0);
			expect(compareVersionStrings("8.3.1", "8.3")).toBeGreaterThan(0);

			const versions = ["8.3.9", "8.3.27.1606", "8.3.10", "8.3.27.100"];
			versions.sort((a, b) => compareVersionStrings(b, a));
			expect(versions).toEqual(["8.3.27.1606", "8.3.27.100", "8.3.10", "8.3.9"]);
		});

		it("aggregates all paths via getAllToolchainPaths", () => {
			const all = getAllToolchainPaths();

			expect(all.bslAnalyzer).toBeDefined();
			expect(all.toolsDir).toBeDefined();
			expect(all.skillsDir).toBeDefined();
		});
	});
});
