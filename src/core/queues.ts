import { EMPTY_QUEUE, type ThreadQueue } from "./t3/queue.js";

/** `read` is the stamp the shown queue was read at; `version` counts the deck's own changes. */
type Entry = { wanted: string; read?: string; queue?: ThreadQueue; loading: boolean; version: number };

/**
 * Queues of the threads the deck shows, read on demand: a thread's queue is read again only when its shell stamp
 * moves or the deck changed it, one read at a time per thread, and never for a thread with nothing queued.
 */
export class QueueStore {
	readonly #entries = new Map<string, Entry>();

	constructor(private readonly onChange: () => void) {}

	/** The queue as last read (the previous one while a newer read runs); undefined until the first read lands. */
	of(thread: { key: string; queueStamp?: string }, read: () => Promise<ThreadQueue>): ThreadQueue | undefined {
		if (thread.queueStamp === undefined) {
			this.#entries.delete(thread.key);
			return EMPTY_QUEUE;
		}
		const entry = this.#entries.get(thread.key) ?? { wanted: thread.queueStamp, loading: false, version: 0 };
		this.#entries.set(thread.key, entry);
		entry.wanted = thread.queueStamp;
		this.#load(thread.key, entry, read);
		return entry.queue;
	}

	/** Reads the thread's queue again on its next use, after the deck changed it. */
	invalidate(key: string): void {
		const entry = this.#entries.get(key);
		if (entry === undefined) return;
		entry.version++;
		entry.read = undefined;
		this.onChange();
	}

	#load(key: string, entry: Entry, read: () => Promise<ThreadQueue>): void {
		if (entry.loading || entry.read === entry.wanted) return;
		const stamp = entry.wanted;
		const version = entry.version;
		entry.loading = true;
		read()
			.then(
				(queue) => {
					entry.queue = queue;
				},
				// A failed read keeps what was shown; the next stamp change reads again.
				() => undefined,
			)
			.finally(() => {
				entry.loading = false;
				entry.read = entry.version === version ? stamp : undefined;
				if (this.#entries.get(key) !== entry) return;
				this.#load(key, entry, read);
				this.onChange();
			});
	}
}
