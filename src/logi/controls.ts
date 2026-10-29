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
