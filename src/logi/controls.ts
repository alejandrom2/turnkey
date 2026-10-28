import type { DeckState } from "../core/t3/shell.js";

/**
 * What Continue does for the selected thread: open one that waits on you (you approve or answer in T3 Code), nudge one
 * that stopped, finished or sits idle, and leave a busy one alone.
 */
export function continueStep(thread: { deck: DeckState } | undefined): "open" | "send" | undefined {
	switch (thread?.deck) {
		case undefined:
		case "running":
		case "queued":
			return undefined;
		case "approval":
		case "question":
			return "open";
		default:
			return "send";
	}
}

/** The choice after the current one, wrapping, as the Stream Deck's keys step; the first when none is current. */
export const nextChoice = <T extends { key: string }>(state: { choices: readonly T[]; current: { key: string } | undefined }): T | undefined =>
	state.choices[(state.choices.findIndex((choice) => choice.key === state.current?.key) + 1) % state.choices.length];
