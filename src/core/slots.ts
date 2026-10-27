import type { DeckThread } from "./board.js";

export type PlacedKey = {
	id: string;
	/** Keys only share positions with keys of the same action, device and thread source. */
	group: string;
	/** Absent for a key inside a multi-action. */
	position?: { row: number; column: number };
	/** 1-based board slot set by hand; 0 is the selected thread; absent fills by position. */
	slot?: number;
};

/** A key's place on the board: an index into its thread list, or the selected thread. */
export type SlotIndex = number | "selected";

/** Reads a slot setting: "" or anything not a whole number means fill by position. */
export function slotSetting(value: unknown): number | undefined {
	if (value === undefined || value === null || value === "") return undefined;
	const slot = Number(value);
	return Number.isInteger(slot) && slot >= 0 ? slot : undefined;
}

/**
 * Fills keys without a slot from the top of the list in reading order (top to bottom, left to right), skipping
 * slots that other keys of the group set by hand. Keys without a position take the first free slot.
 */
export function assignSlots(keys: readonly PlacedKey[]): Map<string, SlotIndex> {
	const result = new Map<string, SlotIndex>();
	const groups = new Map<string, PlacedKey[]>();
	for (const key of keys) {
		if (key.slot === 0) result.set(key.id, "selected");
		else if (key.slot !== undefined) result.set(key.id, key.slot - 1);
		else groups.set(key.group, [...(groups.get(key.group) ?? []), key]);
	}
	for (const [group, auto] of groups) {
		const taken = new Set(keys.filter((key) => key.group === group && key.slot !== undefined && key.slot > 0).map((key) => key.slot! - 1));
		const ordered = [...auto].sort((a, b) => order(a) - order(b) || a.id.localeCompare(b.id));
		let next = 0;
		for (const key of ordered) {
			if (key.position === undefined) {
				result.set(key.id, firstFree(taken, 0));
				continue;
			}
			next = firstFree(taken, next);
			result.set(key.id, next++);
		}
	}
	return result;
}

const order = (key: PlacedKey): number => (key.position === undefined ? -1 : key.position.row * 1000 + key.position.column);

function firstFree(taken: ReadonlySet<number>, from: number): number {
	let index = from;
	while (taken.has(index)) index++;
	return index;
}

/** Activity's `filter` setting. */
export type ThreadFilter = "all" | "attention" | "active" | "unread";

export const threadFilter = (value: unknown): ThreadFilter => (value === "attention" || value === "active" || value === "unread" ? value : "all");

/** Whether `thread` passes Activity's filter and optional project. */
export function matchesFilter(thread: Pick<DeckThread, "deck" | "unseen" | "projectId">, filter: ThreadFilter, projectId?: string): boolean {
	if (projectId && thread.projectId !== projectId) return false;
	switch (filter) {
		case "attention":
			return thread.deck === "approval" || thread.deck === "question" || thread.deck === "failed" || (thread.deck === "done" && thread.unseen);
		case "active":
			return thread.deck === "running" || thread.deck === "queued";
		case "unread":
			return thread.unseen;
		default:
			return true;
	}
}
