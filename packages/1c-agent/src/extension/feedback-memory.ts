// Сохранение отзывов пользователя (лайк/дизлайк, комментарий) в память проекта в виде уроков для будущих сессий.

import * as crypto from "node:crypto";
import type { ExtensionAPI, SubmitFeedbackEvent } from "@earendil-works/pi-coding-agent";
import type { MemoryStore } from "../memory/index.ts";

export function registerFeedbackMemory(pi: ExtensionAPI, memoryStore: MemoryStore, projectRoot: string): void {
	// Подписывается на отзывы пользователя и превращает их в уроки памяти проекта без повторов.
	const processed = new Set<string>();
	pi.on("submit_feedback", (event: SubmitFeedbackEvent) => {
		const feedback = event?.feedback;
		if (!feedback) {
			return;
		}
		const id = String(feedback.id || crypto.randomUUID());
		if (processed.has(id)) {
			return;
		}
		processed.add(id);
		memoryStore.saveFeedback({ ...feedback, id }, projectRoot);
		const comment = typeof feedback.comment === "string" ? feedback.comment.trim() : "";
		if (comment) {
			memoryStore.saveLesson({ lesson: comment, cwd: projectRoot, scope: "project", confidence: 1.0 });
		} else if (Array.isArray(feedback.categories) && feedback.categories.length > 0 && feedback.kind === "dislike") {
			memoryStore.saveLesson({
				lesson: `Избегать замечаний: ${feedback.categories.join(", ")}`,
				cwd: projectRoot,
				scope: "project",
				confidence: 0.9,
			});
		}
	});
}
