import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FEEDBACK_DIR = join(import.meta.dir, "..", "..", "feedback");

export type RetrievedNode = {
	toolName: string;
	input: unknown;
	output: unknown;
};

export type FeedbackData = {
	query_id: string;
	query: string;
	response_text: string;
	retrieved_nodes: RetrievedNode[];
	user_rating: number;
	user_harm: number;
	user_feedback: string;
	timestamp: string;
};

/**
 * Generate a unique query ID from a timestamp and random hex suffix.
 */
export function generateQueryId(): string {
	const ts = Date.now();
	const rand = Math.random().toString(16).slice(2, 10);
	return `${ts}-${rand}`;
}

/**
 * Save feedback data as a JSON file in the feedback/ directory.
 * Creates the directory if it doesn't exist.
 */
export function saveFeedback(data: FeedbackData): void {
	if (!existsSync(FEEDBACK_DIR)) {
		mkdirSync(FEEDBACK_DIR, { recursive: true });
	}

	const filePath = join(FEEDBACK_DIR, `${data.query_id}.json`);
	writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}
