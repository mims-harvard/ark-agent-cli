import type { ComponentType } from "react";
import type { RetrievedNode } from "./store.ts";

/**
 * Shape of the captured response data stored on globalThis so the
 * feedback dialog (rendered inside the @ai-tui/core tree) can read it.
 */
export type CapturedResponseData = {
	queryId: string;
	query: string;
	responseText: string;
	retrievedNodes: RetrievedNode[];
};

/**
 * Props the feedback form component receives from the patched
 * @ai-tui/core /feedback command handler.
 */
export type FeedbackFormProps = {
	onClose: () => void;
};

declare global {
	// biome-ignore lint: augmenting globalThis
	var __arkFeedbackForm: ComponentType<FeedbackFormProps> | undefined;
	// biome-ignore lint: augmenting globalThis
	var __arkCapturedResponse: CapturedResponseData | undefined;
}
