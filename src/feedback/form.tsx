import { useState, useCallback, useRef } from "react";
// @ts-expect-error — useKeyboard is exported at runtime but NodeNext resolution
// can't follow the extensionless re-exports in @opentui/react's .d.ts chain.
import { useKeyboard } from "@opentui/react";

/** Minimal KeyEvent shape — the full type from @opentui/core also can't be
 *  resolved under NodeNext due to extensionless internal re-exports. */
type KeyEvent = {
	name: string;
	ctrl: boolean;
	preventDefault(): void;
	stopPropagation(): void;
};
import type { FeedbackFormProps } from "./globals.ts";
import { saveFeedback } from "./store.ts";

// ────────────────────────────────────────────────────────────────────────────
// Rating selector (1-5 scale, keyboard-only — no <input>)
//
// Follows the DialogConfirm pattern from @ai-tui/core:
//   useKeyboard fires BEFORE any focused renderable, so we get full control.
//   No <input> element means no keystroke conflicts.
// ────────────────────────────────────────────────────────────────────────────

function RatingStep({
	question,
	subtitle,
	initialValue,
	onSelect,
	onBack,
}: {
	question: string;
	subtitle: string;
	initialValue: number;
	onSelect: (value: number) => void;
	onBack: (() => void) | null; // null = first step, no back
}) {
	const [value, setValue] = useState(initialValue || 3);

	useKeyboard((key: KeyEvent) => {
		if (key.name === "left" || key.name === "h") {
			key.preventDefault();
			setValue((v) => Math.max(1, v - 1));
		} else if (key.name === "right" || key.name === "l") {
			key.preventDefault();
			setValue((v) => Math.min(5, v + 1));
		} else if (key.name === "return") {
			key.preventDefault();
			onSelect(value);
		} else if (key.name === "backspace" && onBack) {
			key.preventDefault();
			onBack();
		} else {
			// Direct number entry: 1-5
			const num = Number.parseInt(key.name, 10);
			if (num >= 1 && num <= 5) {
				key.preventDefault();
				onSelect(num);
			}
		}
	});

	return (
		<box
			flexDirection="column"
			gap={1}
			paddingLeft={2}
			paddingRight={2}
			paddingBottom={1}
			paddingTop={1}
		>
			<box flexDirection="row" justifyContent="space-between">
				<text bold>Feedback</text>
				<text dim>esc to cancel</text>
			</box>

			<text>{question}</text>
			<text dim>{subtitle}</text>

			<box flexDirection="row" gap={1} paddingTop={1}>
				{[1, 2, 3, 4, 5].map((n) => (
					<box
						key={n}
						paddingLeft={1}
						paddingRight={1}
						border={
							n === value
								? undefined
								: ["top", "bottom", "left", "right"]
						}
						backgroundColor={n === value ? "#fab283" : undefined}
						onMouseUp={() => onSelect(n)}
						onMouseOver={() => setValue(n)}
					>
						<text bold={n === value}>{String(n)}</text>
					</box>
				))}
			</box>

			<text dim>
				{onBack
					? "← / → to choose · Enter to confirm · Backspace to go back"
					: "← / → to choose · Enter to confirm"}
			</text>
		</box>
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Free text step — keeps <input> for text editing, but uses useKeyboard
// to intercept Backspace when the input is empty (→ go back).
// ────────────────────────────────────────────────────────────────────────────

function TextStep({
	question,
	onSubmit,
	onBack,
}: {
	question: string;
	onSubmit: (text: string) => void;
	onBack: () => void;
}) {
	const [value, setValue] = useState("");
	const valueRef = useRef(value);
	// Keep ref in sync so the useKeyboard closure always sees latest value
	valueRef.current = value;

	useKeyboard((key: KeyEvent) => {
		if (key.name === "backspace" && valueRef.current === "") {
			key.preventDefault();
			onBack();
		}
	});

	return (
		<box
			flexDirection="column"
			gap={1}
			paddingLeft={2}
			paddingRight={2}
			paddingBottom={1}
			paddingTop={1}
		>
			<box flexDirection="row" justifyContent="space-between">
				<text bold>Feedback</text>
				<text dim>esc to cancel</text>
			</box>

			<text>{question}</text>

			<input
				onSubmit={() => {
					if (valueRef.current.trim()) onSubmit(valueRef.current.trim());
				}}
				onInput={(text: string) => {
					setValue(text);
					valueRef.current = text;
				}}
				placeholder="Type your feedback and press Enter..."
				focused
				cursorColor="#fab283"
			/>

			<text dim>Enter to submit · Backspace (when empty) to go back</text>
		</box>
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Saved confirmation — no <input>, keyboard-only
// ────────────────────────────────────────────────────────────────────────────

function SavedStep({ onClose }: { onClose: () => void }) {
	useKeyboard((key: KeyEvent) => {
		if (key.name === "return") {
			key.preventDefault();
			onClose();
		}
	});

	return (
		<box
			flexDirection="column"
			gap={1}
			paddingLeft={2}
			paddingRight={2}
			paddingBottom={1}
			paddingTop={1}
		>
			<text bold>Feedback</text>
			<text>Thank you! Your feedback has been saved.</text>
			<text dim>Press Enter or Esc to close</text>
		</box>
	);
}

// ────────────────────────────────────────────────────────────────────────────
// Main feedback form (stepped, with back-navigation and state preservation)
//
// Navigation:
//   accuracy → harm → freetext → saved
//   Back: accuracy→close, harm→accuracy, freetext→harm
// ────────────────────────────────────────────────────────────────────────────

type Step = "accuracy" | "harm" | "freetext" | "saved";

export function FeedbackForm({ onClose }: FeedbackFormProps) {
	const [step, setStep] = useState<Step>("accuracy");
	const [accuracy, setAccuracy] = useState<number>(0);
	const [harm, setHarm] = useState<number>(0);

	// ── Step handlers ──────────────────────────────────────────────────

	const handleAccuracy = useCallback((value: number) => {
		setAccuracy(value);
		setStep("harm");
	}, []);

	const handleHarm = useCallback((value: number) => {
		setHarm(value);
		setStep("freetext");
	}, []);

	const handleFreetext = useCallback(
		(text: string) => {
			const captured = globalThis.__arkCapturedResponse;
			if (captured) {
				saveFeedback({
					query_id: captured.queryId,
					query: captured.query,
					response_text: captured.responseText,
					retrieved_nodes: captured.retrievedNodes,
					user_rating: accuracy,
					user_harm: harm,
					user_feedback: text,
					timestamp: new Date().toISOString(),
				});
			}
			setStep("saved");
		},
		[accuracy, harm],
	);

	// ── Back handlers ──────────────────────────────────────────────────

	const backFromHarm = useCallback(() => {
		setStep("accuracy");
	}, []);

	const backFromFreetext = useCallback(() => {
		setStep("harm");
	}, []);

	// ── Render current step ────────────────────────────────────────────

	switch (step) {
		case "accuracy":
			return (
				<RatingStep
					question="Is this response accurate?"
					subtitle="1 = Not accurate at all, 5 = Very accurate"
					initialValue={accuracy || 3}
					onSelect={handleAccuracy}
					onBack={null}
				/>
			);
		case "harm":
			return (
				<RatingStep
					question="How likely is the response to cause clinical harm?"
					subtitle="1 = Very unlikely, 5 = Very likely"
					initialValue={harm || 3}
					onSelect={handleHarm}
					onBack={backFromHarm}
				/>
			);
		case "freetext":
			return (
				<TextStep
					question="Please provide free text feedback about this response."
					onSubmit={handleFreetext}
					onBack={backFromFreetext}
				/>
			);
		case "saved":
			return <SavedStep onClose={onClose} />;
	}
}
