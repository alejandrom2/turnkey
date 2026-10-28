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

/** Where a scroll of `ticks` lands among `values`, stopping at the ends; undefined when it wouldn't change anything. */
export function stepWithin<V>(values: readonly V[], current: V | undefined, ticks: number): V | undefined {
	if (values.length === 0) return undefined;
	const from = Math.max(values.indexOf(current as V), 0);
	const to = Math.min(Math.max(from + ticks, 0), values.length - 1);
	return to === values.indexOf(current as V) ? undefined : values[to];
}
