import type { PinnedLookup } from "./target.js";
import type { Machine } from "./t3/machine.js";
import type { ShellRow } from "./t3/shell.js";

export type { DeckState } from "./t3/shell.js";

/** The slice of a Machine the board reads; tests pass plain objects. */
export type BoardMachine = Pick<Machine, "url" | "state" | "rows" | "visit" | "threadRow">;

export type DeckThread = ShellRow & {
	/** `${environmentId}/${threadId}`: stable across machines and reconnects. */
	key: string;
	machine: Machine;
	environmentId: string;
};

const all = () => true;

/** A dial that stops turning for this long selects the thread it rests on. */
export const SELECT_DEBOUNCE_MS = 300;
/** How long the deck's own visit may take to come back as a newer open stamp. */
const ECHO_MS = 5_000;

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

function orderThreads(threads: DeckThread[]): DeckThread[] {
	return threads.sort((a, b) => rank(a) - rank(b) || recency(b) - recency(a) || a.key.localeCompare(b.key));
}

const newestOpened = (threads: readonly DeckThread[]): DeckThread | undefined =>
	threads.reduce<DeckThread | undefined>(
		(best, thread) => (thread.openedAt !== undefined && (best === undefined || thread.openedAt > best.openedAt!) ? thread : best),
		undefined,
	);

/** What keys show; a change outside these fields does not repaint the deck. */
const signature = (threads: readonly DeckThread[], selection: unknown): string =>
	JSON.stringify([threads.map(({ machine: _machine, updatedAt: _updatedAt, openedAt: _openedAt, ...shown }) => shown), selection]);

/** One machine's selection; `seq` orders selections across machines in the order the deck saw them. */
type Selection = { key: string; seq: number; openedAt: number | undefined };

/**
 * Merges the live threads of every ready machine into one ordered list, and follows T3 Code's selection: the
 * thread opened last. Open stamps are compared only within a machine, in the order they arrive, so clock skew
 * between machines never matters; the deck's own picks join the same order.
 */
export class ThreadBoard {
	threads: DeckThread[] = [];
	#signature = "";
	readonly #listeners = new Set<() => void>();
	readonly #selected = new Map<string, Selection>();
	/** Per machine: the newest open stamp seen so far. */
	readonly #newest = new Map<string, number>();
	readonly #echoes = new Map<string, number>();
	#seq = 0;
	#pending: { key: string; timer: ReturnType<typeof setTimeout> } | undefined;
	/** Per action instance, the thread its settings pin: those rows repaint the deck even while settled or snoozed. */
	readonly #pinned = new Map<string, string>();

	constructor(
		private readonly machines: () => readonly BoardMachine[],
		private readonly now: () => number = Date.now,
	) {}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	/** Rebuilds from the machines; listeners hear about it only when something a key shows changed. */
	update(): void {
		const threads: DeckThread[] = [];
		const byMachine = new Map<string, DeckThread[]>();
		const machines = this.machines();
		// A removed machine's selection goes with it; one that is only offline keeps its own.
		const present = new Set(machines.map((machine) => machine.url));
		for (const map of [this.#selected, this.#newest]) for (const url of map.keys()) if (!present.has(url)) map.delete(url);
		for (const machine of machines) {
			if (machine.state.kind !== "ready") continue;
			const environmentId = machine.state.environmentId;
			const own = machine.rows.map((row): DeckThread => ({ ...row, key: `${environmentId}/${row.threadId}`, machine: machine as Machine, environmentId }));
			byMachine.set(machine.url, own);
			threads.push(...own);
		}
		const now = this.now();
		for (const [key, until] of this.#echoes) if (until <= now) this.#echoes.delete(key);
		for (const [url, own] of byMachine) this.#follow(url, own);
		this.threads = orderThreads(threads);
		this.#refresh();
	}

	/** An open stamp newer than any seen on the machine is a selection made in T3 Code. */
	#follow(url: string, threads: readonly DeckThread[]): void {
		const top = newestOpened(threads);
		const newest = this.#newest.get(url);
		if (top === undefined) {
			// Listed but never opened (a server that just gained open stamps): the first open is a selection.
			if (threads.length > 0 && newest === undefined) this.#newest.set(url, -Infinity);
			return;
		}
		this.#newest.set(url, Math.max(newest ?? top.openedAt!, top.openedAt!));
		if (newest === undefined) {
			if (!this.#selected.has(url)) this.#selected.set(url, { key: top.key, seq: 0, openedAt: top.openedAt });
			return;
		}
		const fresh = newestOpened(threads.filter((thread) => thread.openedAt! > newest && !this.#echoes.has(thread.key)));
		if (fresh !== undefined) this.#selected.set(url, { key: fresh.key, seq: ++this.#seq, openedAt: fresh.openedAt });
	}

	/**
	 * A thread by key wherever it is: listed, or settled or snoozed on its machine. Gone once its machine no longer has
	 * it (archived or deleted); unknown while that machine is offline or has no thread list yet.
	 */
	lookup(key: string): PinnedLookup<DeckThread> {
		const listed = this.threads.find((thread) => thread.key === key);
		if (listed !== undefined) return { state: "found", thread: listed };
		const split = key.indexOf("/");
		const environmentId = key.slice(0, split);
		const machine = this.machines().find((candidate) => candidate.state.kind === "ready" && candidate.state.environmentId === environmentId);
		const row = split < 0 ? null : machine?.threadRow(key.slice(split + 1));
		if (row === undefined || (row === null && machine === undefined)) return { state: "unknown" };
		if (row === null) return { state: "gone" };
		return { state: "found", thread: { ...row, key, machine: machine as Machine, environmentId } };
	}

	/** Follows (or, with undefined, stops following) the thread an action instance pins. */
	pin(owner: string, key: string | undefined): void {
		if (key === undefined || key === "") this.#pinned.delete(owner);
		else this.#pinned.set(owner, key);
	}

	/** Threads of one machine (its URL), or of every machine when `machine` is empty. */
	threadsOn(machine?: string): DeckThread[] {
		return machine ? this.threads.filter((thread) => thread.machine.url === machine) : this.threads;
	}

	/**
	 * The thread selected in T3 Code on one machine, or the latest selection across machines. When it is not
	 * listed (settled, snoozed, archived), the newest-opened listed thread stands in, then the most urgent.
	 */
	selectedOn(machine?: string): DeckThread | undefined {
		const threads = this.threadsOn(machine);
		if (threads.length === 0) return undefined;
		const selections = machine
			? [this.#selected.get(machine)]
			: [...this.#selected.values()].sort((a, b) => b.seq - a.seq || (b.openedAt ?? -Infinity) - (a.openedAt ?? -Infinity));
		for (const selection of selections) {
			const thread = selection && threads.find((candidate) => candidate.key === selection.key);
			if (thread !== undefined) return thread;
		}
		return newestOpened(threads) ?? threads[0];
	}

	/**
	 * Selects a thread the way opening it in T3 Code does: a visit with `opened`, which also marks it read. The
	 * deck follows at once, since T3 Code keeps the old stamp for a reopen within 10 minutes and a read-only
	 * pairing can't visit. `key` may name a thread the shell has not listed yet, such as one just launched.
	 */
	async select(key: string, machineUrl: string): Promise<void> {
		this.#clearPending();
		this.#selected.set(machineUrl, { key, seq: ++this.#seq, openedAt: undefined });
		this.#refresh();
		const thread = this.threads.find((candidate) => candidate.key === key);
		if (thread === undefined) return;
		this.#echoes.set(key, this.now() + ECHO_MS);
		await thread.machine.visit(thread, { opened: true });
	}

	/** The thread a turning dial points at before selecting it; undefined when it is not on `machine` or fails `match`. */
	pendingOn(machine?: string, match: (thread: DeckThread) => boolean = all): DeckThread | undefined {
		const key = this.#pending?.key;
		return key === undefined ? undefined : this.threadsOn(machine).find((thread) => thread.key === key && match(thread));
	}

	/** What a dial showing the threads that pass `match` points at: its pending pick, the selection, else the first. */
	shownOn(machine?: string, match: (thread: DeckThread) => boolean = all): DeckThread | undefined {
		const selected = this.selectedOn(machine);
		return this.pendingOn(machine, match) ?? (selected !== undefined && match(selected) ? selected : this.threadsOn(machine).find(match));
	}

	/** Moves the pending choice by `steps` through one machine's threads (or all) that pass `match`, clamped; it selects once the dial rests. */
	step(steps: number, machine?: string, match: (thread: DeckThread) => boolean = all): void {
		const threads = this.threadsOn(machine).filter(match);
		if (threads.length === 0) return;
		const selected = this.selectedOn(machine);
		const from = Math.max(0, threads.indexOf(this.shownOn(machine, match)!));
		const next = threads[Math.min(threads.length - 1, Math.max(0, from + steps))];
		this.#clearPending();
		if (next.key !== selected?.key) {
			const timer = setTimeout(() => void this.select(next.key, next.machine.url).catch(() => undefined), SELECT_DEBOUNCE_MS);
			this.#pending = { key: next.key, timer };
		}
		this.#refresh();
	}

	#clearPending(): void {
		clearTimeout(this.#pending?.timer);
		this.#pending = undefined;
	}

	#refresh(): void {
		const urls = [...new Set(this.threads.map((thread) => thread.machine.url))];
		const selection = [this.selectedOn()?.key, this.#pending?.key, ...urls.map((url) => this.selectedOn(url)?.key)];
		const listed = new Set(this.threads.map((thread) => thread.key));
		const hidden = [...new Set(this.#pinned.values())].filter((key) => !listed.has(key)).map((key) => this.lookup(key));
		const next = signature(this.threads, [selection, hidden.map((found) => (found.state === "found" ? signature([found.thread], undefined) : found.state))]);
		if (next === this.#signature) return;
		this.#signature = next;
		for (const listener of this.#listeners) listener();
	}
}
