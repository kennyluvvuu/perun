export interface FeedbackRecord {
	id: string;
	kind?: string | null;
	target?: string | null;
	file?: string | null;
	start_line?: number | null;
	end_line?: number | null;
	categories?: string | null;
	comment?: string | null;
	original_code?: string | null;
	rewritten_code?: string | null;
	model?: string | null;
	cwd?: string | null;
	created_at?: string | null;
}

export interface LessonRecord {
	id: string;
	scope?: string | null;
	key?: string | null;
	lesson: string;
	cwd?: string | null;
	confidence?: number | null;
	created_at?: string | null;
}
