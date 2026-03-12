import type {
	ChatTransport,
	UIMessage,
	UIMessageChunk,
} from "ai";

import { generateQueryId, type RetrievedNode } from "./store.ts";
import "./globals.ts";

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Extract the plain text typed by the user from the last message in the
 * conversation history.
 */
function extractUserText(messages: UIMessage[]): string {
	const last = messages[messages.length - 1];
	if (!last || last.role !== "user") return "";
	return last.parts
		.filter((p): p is { type: "text"; text: string } => p.type === "text")
		.map((p) => p.text)
		.join("")
		.trim();
}

// ────────────────────────────────────────────────────────────────────────────
// FeedbackChatTransport
// ────────────────────────────────────────────────────────────────────────────

/**
 * A ChatTransport wrapper that captures response data (text + tool I/O)
 * from every agent response and stores it on `globalThis.__arkCapturedResponse`
 * so that the /feedback slash-command dialog can read it.
 *
 * It also appends a "Type /feedback to rate this response" hint at the end
 * of each response stream.
 */
export class FeedbackChatTransport implements ChatTransport<UIMessage> {
	private wrapped: ChatTransport<UIMessage>;

	constructor(wrapped: ChatTransport<UIMessage>) {
		this.wrapped = wrapped;
	}

	// ── ChatTransport interface ──────────────────────────────────────────

	async sendMessages(
		options: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0],
	): Promise<ReadableStream<UIMessageChunk>> {
		const userText = extractUserText(options.messages);
		const innerStream = await this.wrapped.sendMessages(options);
		return this.wrapAgentStream(innerStream, userText);
	}

	reconnectToStream(
		options: Parameters<ChatTransport<UIMessage>["reconnectToStream"]>[0],
	) {
		return this.wrapped.reconnectToStream(options);
	}

	// ── Stream wrapping ──────────────────────────────────────────────────

	/**
	 * Pipe the agent response stream through a transform that:
	 *   - passes every chunk through unchanged
	 *   - captures text-delta content and tool I/O
	 *   - injects a feedback prompt just before the "finish" chunk
	 *   - stores captured data on globalThis for the /feedback dialog
	 */
	private wrapAgentStream(
		inner: ReadableStream<UIMessageChunk>,
		queryText: string,
	): ReadableStream<UIMessageChunk> {
		let responseText = "";
		const nodes: RetrievedNode[] = [];
		const toolCallMap = new Map<
			string,
			{ toolName: string; input: unknown }
		>();
		const queryId = generateQueryId();

		const transform = new TransformStream<UIMessageChunk, UIMessageChunk>({
			transform(chunk, controller) {
				// Accumulate text deltas
				if (chunk.type === "text-delta") {
					responseText += chunk.delta;
				}

				// Track tool inputs
				if (chunk.type === "tool-input-available") {
					toolCallMap.set(chunk.toolCallId, {
						toolName: chunk.toolName,
						input: chunk.input,
					});
				}

				// Track tool outputs, pairing with their inputs
				if (chunk.type === "tool-output-available") {
					const call = toolCallMap.get(chunk.toolCallId);
					nodes.push({
						toolName: call?.toolName ?? "unknown",
						input: call?.input ?? null,
						output: chunk.output,
					});
				}

				// Inject feedback prompt just before the stream finishes
				if (chunk.type === "finish") {
					const promptId = `feedback-prompt-${Date.now()}`;
					controller.enqueue({ type: "text-start", id: promptId });
					controller.enqueue({
						type: "text-delta",
						id: promptId,
						delta: "\n\n---\nType **/feedback** to rate this response.",
					});
					controller.enqueue({ type: "text-end", id: promptId });

					// Store captured data on globalThis for the dialog
					globalThis.__arkCapturedResponse = {
						queryId,
						query: queryText,
						responseText,
						retrievedNodes: nodes,
					};
				}

				// Always forward the original chunk
				controller.enqueue(chunk);
			},
		});

		return inner.pipeThrough(transform);
	}
}
