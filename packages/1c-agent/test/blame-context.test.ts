import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getGitBlameContext } from "../src/git/blame-context.ts";

describe("Git Blame Context Analyzer", () => {
	let testRepoDir: string;
	const gitEnv = {
		...process.env,
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_TERMINAL_PROMPT: "0",
	};

	beforeAll(() => {
		testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "blame-context-test-"));
		execFileSync("git", ["init"], { cwd: testRepoDir, env: gitEnv });
		execFileSync("git", ["config", "user.name", "Иван Разработчик"], { cwd: testRepoDir, env: gitEnv });
		execFileSync("git", ["config", "user.email", "ivan@example.com"], { cwd: testRepoDir, env: gitEnv });
		execFileSync("git", ["config", "core.quotepath", "false"], { cwd: testRepoDir, env: gitEnv });

		const modulePath = path.join(testRepoDir, "CalculationModule.bsl");
		fs.writeFileSync(
			modulePath,
			[
				"// Модуль расчета",
				"Функция ПолучитьСуммуСкидки(СуммаДокумента, Процент)",
				"\tЕсли Процент = 0 Тогда",
				"\t\tВозврат 0;",
				"\tКонецЕсли;",
				"\tВозврат (СуммаДокумента * Процент) / 100;",
				"КонецФункции",
			].join("\n"),
			"utf-8",
		);

		execFileSync("git", ["add", "CalculationModule.bsl"], { cwd: testRepoDir, env: gitEnv });
		execFileSync("git", ["commit", "-m", "Реализация расчета скидок ТЗ-777 #42"], {
			cwd: testRepoDir,
			env: gitEnv,
		});
	});

	afterAll(() => {
		try {
			fs.rmSync(testRepoDir, { recursive: true, force: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	it("analyzes context by line number (number)", async () => {
		const result = await getGitBlameContext("CalculationModule.bsl", 2, testRepoDir);

		expect(result.filePath).toBe("CalculationModule.bsl");
		expect(result.target).toBe("2");
		expect(result.blameLines.length).toBeGreaterThan(0);
		expect(result.blameLines[0].line).toBe(2);
		expect(result.blameLines[0].author).toBe("Иван Разработчик");
		expect(result.blameLines[0].content).toContain("Функция ПолучитьСуммуСкидки");

		expect(result.commits.length).toBeGreaterThan(0);
		expect(result.commits[0].taskRefs).toContain("ТЗ-777");
		expect(result.commits[0].taskRefs).toContain("#42");

		expect(result.summary).toContain("Строка 2");
		expect(result.summary).toContain("Иван Разработчик");
		expect(result.summary).toContain("ТЗ-777");
	});

	it("analyzes context by line number (string of digits)", async () => {
		const result = await getGitBlameContext("CalculationModule.bsl", "6", testRepoDir);

		expect(result.target).toBe("6");
		expect(result.blameLines.length).toBeGreaterThan(0);
		expect(result.blameLines[0].line).toBe(6);
		expect(result.summary).toContain("Строка 6");
	});

	it("analyzes context by symbol name (string)", async () => {
		const result = await getGitBlameContext("CalculationModule.bsl", "ПолучитьСуммуСкидки", testRepoDir);

		expect(result.filePath).toBe("CalculationModule.bsl");
		expect(result.target).toBe("ПолучитьСуммуСкидки");
		expect(result.blameLines.length).toBeGreaterThan(0);
		expect(result.commits.length).toBeGreaterThan(0);
		expect(result.commits[0].taskRefs).toContain("ТЗ-777");

		expect(result.summary).toContain("ПолучитьСуммуСкидки");
		expect(result.summary).toContain("Иван Разработчик");
		expect(result.summary).toContain("ТЗ-777");
	});

	it("handles non-existent symbol gracefully", async () => {
		const result = await getGitBlameContext("CalculationModule.bsl", "НесуществующийСимвол", testRepoDir);

		expect(result.target).toBe("НесуществующийСимвол");
		expect(result.blameLines).toEqual([]);
		expect(result.summary).toContain("НесуществующийСимвол");
	});
});
