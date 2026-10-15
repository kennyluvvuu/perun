import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	extractTaskRefs,
	getChangedFiles,
	getCommitInfo,
	getFileContentAtRef,
	runGitBlame,
	runGitLogForFile,
	runGitLogForSymbol,
} from "../src/git/git-runner.ts";

describe("Git Runner & Task Ref Extraction", () => {
	describe("extractTaskRefs", () => {
		it("extracts numeric issue references (#123)", () => {
			const refs = extractTaskRefs("Fix bug in calculation #42 and close #999");
			expect(refs).toEqual(["#42", "#999"]);
		});

		it("extracts Latin uppercase task prefixes (TASK-123, JIRA-456)", () => {
			const refs = extractTaskRefs("feat(billing): implement TASK-101 and JIRA-404");
			expect(refs).toEqual(["TASK-101", "JIRA-404"]);
		});

		it("extracts Cyrillic task prefixes (ТЗ-123, ЗАДАЧА-789)", () => {
			const refs = extractTaskRefs("Исправление ошибки проведения ТЗ-451 и ЗАДАЧА-12");
			expect(refs).toEqual(["ТЗ-451", "ЗАДАЧА-12"]);
		});

		it("deduplicates repeated task references", () => {
			const refs = extractTaskRefs("ТЗ-123: повторный коммит по ТЗ-123 и #50 #50");
			expect(refs).toEqual(["ТЗ-123", "#50"]);
		});

		it("ignores single-letter prefixes like A-1 or numbers without prefix", () => {
			const refs = extractTaskRefs("Update version A-1 with 12345 changes");
			expect(refs).toEqual([]);
		});

		it("handles empty or whitespace messages", () => {
			expect(extractTaskRefs("")).toEqual([]);
			expect(extractTaskRefs("   ")).toEqual([]);
		});

		it("respects Cyrillic identifier boundaries without breaking on Russian words", () => {
			const refs = extractTaskRefs("Анализ-123 не должен ломаться, но ТЗ-999 должен быть найден");
			expect(refs).toContain("ТЗ-999");
		});
	});

	describe("Git operations in temporary repository", () => {
		let testRepoDir: string;
		const gitEnv = {
			...process.env,
			GIT_CONFIG_GLOBAL: "/dev/null",
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_TERMINAL_PROMPT: "0",
		};

		beforeAll(() => {
			testRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "git-runner-test-"));
			execFileSync("git", ["init"], { cwd: testRepoDir, env: gitEnv });
			execFileSync("git", ["config", "user.name", "Тест Тестович"], { cwd: testRepoDir, env: gitEnv });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: testRepoDir, env: gitEnv });
			execFileSync("git", ["config", "core.quotepath", "false"], { cwd: testRepoDir, env: gitEnv });

			// Initial commit
			const file1 = path.join(testRepoDir, "CommonModule.bsl");
			fs.writeFileSync(
				file1,
				"// Модуль общих функций\nПроцедура РассчитатьСкидку()\n\tСкидка = 10;\nКонецПроцедуры\n",
				"utf-8",
			);
			execFileSync("git", ["add", "CommonModule.bsl"], { cwd: testRepoDir, env: gitEnv });
			execFileSync("git", ["commit", "-m", "Начальная инициализация #101 по ТЗ-500"], {
				cwd: testRepoDir,
				env: gitEnv,
			});

			// Second commit with Cyrillic filename
			const file2 = path.join(testRepoDir, "МодульМенеджера.bsl");
			fs.writeFileSync(file2, "Процедура ОбработкаПроведения()\n\tКоличество = 5;\nКонецПроцедуры\n", "utf-8");
			execFileSync("git", ["add", "МодульМенеджера.bsl"], { cwd: testRepoDir, env: gitEnv });
			execFileSync("git", ["commit", "-m", "Добавлен модуль проведения TASK-88"], {
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

		it("runGitLogForFile returns commits with extracted task references", async () => {
			const commits = await runGitLogForFile("CommonModule.bsl", 5, testRepoDir);
			expect(commits.length).toBeGreaterThan(0);
			expect(commits[0].author).toBe("Тест Тестович");
			expect(commits[0].message).toContain("Начальная инициализация");
			expect(commits[0].taskRefs).toContain("#101");
			expect(commits[0].taskRefs).toContain("ТЗ-500");
		});

		it("runGitLogForSymbol finds commits containing symbol", async () => {
			const commits = await runGitLogForSymbol("CommonModule.bsl", "РассчитатьСкидку", 5, testRepoDir);
			expect(commits.length).toBe(1);
			expect(commits[0].taskRefs).toContain("ТЗ-500");
		});

		it("runGitBlame blames specific line ranges", async () => {
			const blameLines = await runGitBlame("CommonModule.bsl", 2, 3, testRepoDir);
			expect(blameLines.length).toBe(2);
			expect(blameLines[0].line).toBe(2);
			expect(blameLines[0].author).toBe("Тест Тестович");
			expect(blameLines[0].content).toContain("Процедура РассчитатьСкидку");
			expect(blameLines[1].line).toBe(3);
			expect(blameLines[1].content).toContain("Скидка = 10");
		});

		it("getFileContentAtRef retrieves file content at HEAD", async () => {
			const content = await getFileContentAtRef("CommonModule.bsl", "HEAD", testRepoDir);
			expect(content).toContain("Процедура РассчитатьСкидку");
		});

		it("getFileContentAtRef returns null for non-existent file or ref", async () => {
			const content = await getFileContentAtRef("Missing.bsl", "HEAD", testRepoDir);
			expect(content).toBeNull();
		});

		it("getCommitInfo loads commit metadata by full hash", async () => {
			const commits = await runGitLogForFile("CommonModule.bsl", 1, testRepoDir);
			const fullHash = commits[0].commitHash;
			const info = await getCommitInfo(fullHash, testRepoDir);
			expect(info).not.toBeNull();
			expect(info?.commitHash).toBe(fullHash);
			expect(info?.author).toBe("Тест Тестович");
			expect(info?.taskRefs).toContain("#101");
		});

		it("getChangedFiles detects staged and working tree changes", async () => {
			// Make working tree changes
			const file1 = path.join(testRepoDir, "CommonModule.bsl");
			fs.appendFileSync(file1, "// Новая строка комментария\n", "utf-8");

			const workingChanges = await getChangedFiles("working", testRepoDir);
			const foundWorking = workingChanges.find((c) => c.path.includes("CommonModule.bsl"));
			expect(foundWorking).toBeDefined();
			expect(foundWorking?.status).toBe("M");

			// Stage changes
			execFileSync("git", ["add", "CommonModule.bsl"], { cwd: testRepoDir, env: gitEnv });

			const stagedChanges = await getChangedFiles("staged", testRepoDir);
			const foundStaged = stagedChanges.find((c) => c.path.includes("CommonModule.bsl"));
			expect(foundStaged).toBeDefined();
			expect(foundStaged?.status).toBe("M");
		});

		it("getChangedFiles supports Cyrillic filenames", async () => {
			const file2 = path.join(testRepoDir, "МодульМенеджера.bsl");
			fs.appendFileSync(file2, "// Изменение проведения\n", "utf-8");

			const headChanges = await getChangedFiles("HEAD", testRepoDir);
			const foundCyrillic = headChanges.find((c) => c.path === "МодульМенеджера.bsl");
			expect(foundCyrillic).toBeDefined();
		});

		it("getChangedFiles handles ref comparisons like HEAD~1", async () => {
			const head1Changes = await getChangedFiles("HEAD~1", testRepoDir);
			expect(head1Changes.length).toBeGreaterThan(0);
			const hasModule = head1Changes.some((c) => c.path === "МодульМенеджера.bsl");
			expect(hasModule).toBe(true);
		});

		it("getChangedFiles includes untracked files with status A in working", async () => {
			const untrackedFile = path.join(testRepoDir, "НовыйМодуль.bsl");
			fs.writeFileSync(untrackedFile, "// Новый незакоммиченный модуль\n", "utf-8");

			const workingChanges = await getChangedFiles("working", testRepoDir);
			const foundUntracked = workingChanges.find((c) => c.path === "НовыйМодуль.bsl");
			expect(foundUntracked).toBeDefined();
			expect(foundUntracked?.status).toBe("A");
		});

		it("handles non-git directories gracefully without throwing unhandled rejection", async () => {
			const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), "non-git-"));
			try {
				const changes = await getChangedFiles("HEAD", emptyDir);
				expect(changes).toEqual([]);
				const blame = await runGitBlame("any.txt", 1, 1, emptyDir);
				expect(blame).toEqual([]);
				const logs = await runGitLogForFile("any.txt", 5, emptyDir);
				expect(logs).toEqual([]);
			} finally {
				fs.rmSync(emptyDir, { recursive: true, force: true });
			}
		});
	});
});
