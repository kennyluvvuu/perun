import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
	SubmitFeedbackEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOnecAgentExtension } from "../src/index.ts";
import { formatMemoryContext, MemoryStore } from "../src/memory/index.ts";

describe("1C Persistent Memory & Feedback", () => {
	let tempDir: string;
	let dbPath: string;

	beforeEach(async () => {
		tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "perun-memory-test-"));
		dbPath = path.join(tempDir, "memory.db");
	});

	afterEach(async () => {
		await fs.promises.rm(tempDir, { recursive: true, force: true });
	});

	it("creates database and saves feedback records", () => {
		const store = new MemoryStore(dbPath);

		const feedback = {
			id: "fb-1",
			kind: "code",
			target: "BSL",
			file: "Documents/Order/ObjectModule.bsl",
			start_line: 10,
			end_line: 25,
			categories: ["style", "performance"],
			comment: "Query in loop detected, moved outside loop",
			original_code: "For Each Row In Table Do Query.Execute() EndDo;",
			rewritten_code: "Query.Execute(); For Each Row In Table Do EndDo;",
			model: "claude-sonnet-4-5",
			cwd: "/workspace/project",
			created_at: "2026-10-15T12:00:00.000Z",
		};

		const saved = store.saveFeedback(feedback);
		expect(saved.id).toBe("fb-1");
		expect(saved.kind).toBe("code");
		expect(saved.file).toBe("Documents/Order/ObjectModule.bsl");
		expect(saved.start_line).toBe(10);
		expect(saved.end_line).toBe(25);
		expect(saved.categories).toBe(JSON.stringify(["style", "performance"]));
		expect(saved.comment).toBe("Query in loop detected, moved outside loop");

		const all = store.getFeedbacks();
		expect(all.length).toBe(1);
		expect(all[0].id).toBe("fb-1");
		expect(all[0].model).toBe("claude-sonnet-4-5");

		store.close();
	});

	it("saves lessons and queries relevant lessons for cwd", () => {
		const store = new MemoryStore(dbPath);

		store.saveLesson({
			id: "lesson-1",
			scope: "project",
			key: "QueryInLoop",
			lesson: "Do not place queries inside loops in posting procedures.",
			cwd: "/workspace/project-a",
			confidence: 0.95,
		});

		store.saveLesson({
			id: "lesson-2",
			scope: "global",
			key: "LockData",
			lesson: "Always use DataLock before checking balances.",
			cwd: null,
			confidence: 0.9,
		});

		store.saveLesson({
			id: "lesson-3",
			scope: "project",
			key: "Other",
			lesson: "Specific to project-b.",
			cwd: "/workspace/project-b",
			confidence: 0.8,
		});

		const lessonsA = store.getRelevantLessons("/workspace/project-a");
		expect(lessonsA.length).toBe(2);
		expect(lessonsA.map((l) => l.id)).toEqual(["lesson-1", "lesson-2"]);

		const prompt = formatMemoryContext(lessonsA);
		expect(prompt).toContain("[ПАМЯТЬ АГЕНТА: ПРАВИЛА И УРОКИ ПРОЕКТА]");
		expect(prompt).toContain("- [project:QueryInLoop] Do not place queries inside loops in posting procedures.");
		expect(prompt).toContain("- [global:LockData] Always use DataLock before checking balances.");

		store.close();
	});

	it("listens for submit_feedback and injects memory context on session_start", async () => {
		const store = new MemoryStore(dbPath);
		store.saveLesson({
			id: "l-1",
			scope: "standards",
			key: "BSL",
			lesson: "Always follow 1C ITS standards.",
			cwd: tempDir,
		});
		store.close();

		const eventHandlers = new Map<string, Array<(...args: any[]) => any>>();
		const eventBusHandlers = new Map<string, Array<(...args: any[]) => any>>();
		const sentMessages: any[] = [];

		const mockPi = {
			registerTool: vi.fn(),
			registerCommand: vi.fn(),
			registerShortcut: vi.fn(),
			on: vi.fn((event, handler) => {
				const list = eventHandlers.get(event) ?? [];
				list.push(handler);
				eventHandlers.set(event, list);
				return () => {};
			}),
			events: {
				emit: vi.fn(),
				on: vi.fn((channel, handler) => {
					const list = eventBusHandlers.get(channel) ?? [];
					list.push(handler);
					eventBusHandlers.set(channel, list);
					return () => {};
				}),
			},
			sendMessage: vi.fn((msg) => {
				sentMessages.push(msg);
			}),
			getActiveTools: vi.fn(() => []),
			setActiveTools: vi.fn(),
		} as unknown as ExtensionAPI;

		const mockCtx = {
			cwd: tempDir,
			hasUI: false,
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
			},
			sessionManager: {
				getEntries: vi.fn(() => []),
			},
		} as unknown as ExtensionContext;

		const extension = createOnecAgentExtension({
			projectRoot: tempDir,
			memoryDbPath: dbPath,
		});

		const instance = extension(mockPi);

		// Verify submit_feedback listener persists feedback
		const submitHandler = eventHandlers.get("submit_feedback")?.[0];
		expect(submitHandler).toBeDefined();

		await submitHandler!({
			type: "submit_feedback",
			feedback: {
				id: "rpc-fb-1",
				kind: "code",
				target: "method",
				file: "CommonModules/MyModule.bsl",
				comment: "Good refactoring",
			},
		} as SubmitFeedbackEvent);

		const feedbacks = instance.memoryStore.getFeedbacks();
		expect(feedbacks.length).toBe(1);
		expect(feedbacks[0].id).toBe("rpc-fb-1");
		expect(feedbacks[0].file).toBe("CommonModules/MyModule.bsl");

		// Verify session_start injects hidden memory context
		const sessionStartHandler = eventHandlers.get("session_start")?.[0];
		expect(sessionStartHandler).toBeDefined();

		await sessionStartHandler!({ type: "session_start" } as SessionStartEvent, mockCtx);

		expect(sentMessages.length).toBe(1);
		expect(sentMessages[0].customType).toBe("pi-memory-context");
		expect(sentMessages[0].display).toBe(false);
		expect(sentMessages[0].content).toContain("[ПАМЯТЬ АГЕНТА: ПРАВИЛА И УРОКИ ПРОЕКТА]");
		expect(sentMessages[0].content).toContain("Always follow 1C ITS standards.");

		// Calling session_start again when message is in session entries should not duplicate
		(mockCtx.sessionManager.getEntries as any).mockReturnValue([{ customType: "pi-memory-context" }]);
		await sessionStartHandler!({ type: "session_start" } as SessionStartEvent, mockCtx);
		expect(sentMessages.length).toBe(1); // Still 1

		// Shutdown closes the store cleanly
		const shutdownHandler = eventHandlers.get("session_shutdown")?.[0];
		expect(shutdownHandler).toBeDefined();
		await shutdownHandler!();
	});
});
