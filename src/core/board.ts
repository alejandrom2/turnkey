import type { Machine } from "./t3/machine.js";
import type { ShellRow } from "./t3/shell.js";

export type { DeckState } from "./t3/shell.js";

/** The slice of a Machine the board reads; tests pass plain objects. */
export type BoardMachine = Pick<Machine, "url" | "state" | "rows" | "visit">;

export type DeckThread = ShellRow & {
	/** `${environmentId}/${threadId}`: stable across machines and reconnects. */
	key: string;
	machine: Machine;
	environmentId: string;
};

/** Board order: what needs you, what runs, unseen results, then the rest by recency. */
function rank(thread: DeckThread): number {
	switch (thread.deck) {
		case "approval":
			return 0;
		case "question":
			return 1;
		case "running":
			return 2;
		case "queued":
			return 3;
		case "failed":
		case "done":
		case "stopped":
			return thread.unseen ? 4 : 5;
		default:
			return 5;
	}
}

/** Running rows sort by start, not by `updatedAt`, which moves several times a second while a turn streams. */
const recency = (thread: DeckThread): number => (thread.active ? (thread.activeSince ?? thread.updatedAt) : thread.updatedAt);

export function orderThreads(threads: DeckThread[]): DeckThread[] {
	return threads.sort((a, b) => rank(a) - rank(b) || recency(b) - recency(a) || a.key.localeCompare(b.key));
}

/** What a key can show of a row; a change outside these fields does not repaint the deck. */
const signature = (threads: readonly DeckThread[]): string => JSON.stringify(threads.map(({ machine: _machine, updatedAt: _updatedAt, ...shown }) => shown));

/** Merges the live threads of every ready machine into one ordered list with a shared focus. */
export class ThreadBoard {
	threads: DeckThread[] = [];
	#focusKey: string | undefined;
	#signature = "[]";
	readonly #listeners = new Set<() => void>();

	constructor(private readonly machines: () => readonly BoardMachine[]) {}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Rebuilds from the machines; listeners hear about it only when something a key shows changed. */
	update(): void {
		const threads: DeckThread[] = [];
		for (const machine of this.machines()) {
			if (machine.state.kind !== "ready") continue;
			const environmentId = machine.state.environmentId;
			for (const row of machine.rows) threads.push({ ...row, key: `${environmentId}/${row.threadId}`, machine: machine as Machine, environmentId });
		}
		this.threads = orderThreads(threads);
		const next = signature(this.threads);
		if (next === this.#signature) return;
		this.#signature = next;
		this.#emit();
	}

	get focused(): DeckThread | undefined {
		return this.focusedOn();
	}

	/** Threads of one machine (its URL), or of every machine when `machine` is empty. */
	threadsOn(machine?: string): DeckThread[] {
		return machine ? this.threads.filter((thread) => thread.machine.url === machine) : this.threads;
	}

	/** Focus is shared across the deck; an action pinned to a machine sees that machine's first thread instead. */
	focusedOn(machine?: string): DeckThread | undefined {
		const threads = this.threadsOn(machine);
		return threads.find((thread) => thread.key === this.#focusKey) ?? threads[0];
	}

	focus(key: string): void {
		this.#focusKey = key;
		this.#emit();
	}

	/** Moves focus by `steps` through one machine's threads (or all), clamped at both ends. */
	moveFocus(steps: number, machine?: string): void {
		const threads = this.threadsOn(machine);
		if (threads.length === 0) return;
		const current = Math.max(0, threads.indexOf(this.focusedOn(machine)!));
		const next = Math.min(threads.length - 1, Math.max(0, current + steps));
		this.focus(threads[next].key);
	}

	/** Marks an unseen result read in T3 Code too; the shell echo then clears the dot on every client. */
	async markSeen(key: string): Promise<void> {
		const thread = this.threads.find((candidate) => candidate.key === key);
		if (thread?.unseen) await thread.machine.visit(thread);
	}

	#emit(): void {
		for (const listener of this.#listeners) listener();
	}
}
