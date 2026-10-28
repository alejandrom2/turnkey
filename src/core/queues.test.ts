import { describe, expect, it, vi } from "vitest";

import { QueueStore } from "./queues.js";
import { EMPTY_QUEUE, type ThreadQueue } from "./t3/queue.js";

const queue = (...texts: string[]): ThreadQueue => ({ ...EMPTY_QUEUE, items: texts.map((text, at) => ({ runId: `r${at}`, text })) });

/** A read the test resolves by hand. */
function reads() {
	const pending: ((value: ThreadQueue) => void)[] = [];
	const read = vi.fn(() => new Promise<ThreadQueue>((resolve) => pending.push(resolve)));
	return { read, resolve: async (value: ThreadQueue) => (pending.shift()!(value), await Promise.resolve(), await Promise.resolve(), await Promise.resolve()) };
}

describe("QueueStore", () => {
	it("never reads a thread with nothing queued", () => {
		const { read } = reads();
		const store = new QueueStore(() => undefined);
		expect(store.of({ key: "a", runStamp: "0", mayQueue: false }, read)).toBe(EMPTY_QUEUE);
		expect(read).not.toHaveBeenCalled();
	});

	it("reads once per stamp, keeps the last queue while a newer read runs, and catches up with a stamp that moved meanwhile", async () => {
		const { read, resolve } = reads();
		const onChange = vi.fn();
		const store = new QueueStore(onChange);
		expect(store.of({ key: "a", runStamp: "1", mayQueue: true }, read)).toBeUndefined();
		store.of({ key: "a", runStamp: "1", mayQueue: true }, read);
		expect(read).toHaveBeenCalledTimes(1);
		store.of({ key: "a", runStamp: "2", mayQueue: true }, read);
		expect(read).toHaveBeenCalledTimes(1);
		await resolve(queue("first"));
		expect(onChange).toHaveBeenCalled();
		expect(read).toHaveBeenCalledTimes(2);
		expect(store.of({ key: "a", runStamp: "2", mayQueue: true }, read)?.items.map((item) => item.text)).toEqual(["first"]);
		await resolve(queue("first", "second"));
		expect(store.of({ key: "a", runStamp: "2", mayQueue: true }, read)?.items).toHaveLength(2);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("reads again after the deck changed the queue, even mid-read", async () => {
		const { read, resolve } = reads();
		const store = new QueueStore(() => undefined);
		store.of({ key: "a", runStamp: "1", mayQueue: true }, read);
		store.invalidate("a");
		await resolve(queue("old"));
		expect(read).toHaveBeenCalledTimes(2);
		await resolve(queue());
		expect(store.of({ key: "a", runStamp: "1", mayQueue: true }, read)?.items).toEqual([]);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("reads once more when the shell stops saying queued while messages were waiting, then lets go", async () => {
		const { read, resolve } = reads();
		const store = new QueueStore(() => undefined);
		store.of({ key: "a", runStamp: "1", mayQueue: true }, read);
		await resolve(queue("older", "newest"));
		// Removing the newest message leaves the latest run cancelled, with "older" still queued.
		expect(store.of({ key: "a", runStamp: "2", mayQueue: false }, read)?.items).toHaveLength(2);
		expect(read).toHaveBeenCalledTimes(2);
		await resolve(queue("older"));
		expect(store.of({ key: "a", runStamp: "2", mayQueue: false }, read)?.items.map((item) => item.text)).toEqual(["older"]);
		store.of({ key: "a", runStamp: "3", mayQueue: false }, read);
		await resolve(queue());
		expect(store.of({ key: "a", runStamp: "3", mayQueue: false }, read)).toBe(EMPTY_QUEUE);
		expect(read).toHaveBeenCalledTimes(3);
	});

	it("forgets threads that left the board, and reads one again if it comes back", async () => {
		const { read, resolve } = reads();
		const store = new QueueStore(() => undefined);
		store.of({ key: "a", runStamp: "1", mayQueue: true }, read);
		store.of({ key: "b", runStamp: "1", mayQueue: true }, read);
		await resolve(queue("a"));
		await resolve(queue("b"));
		store.retain(["b"]);
		expect(store.of({ key: "b", runStamp: "1", mayQueue: true }, read)?.items).toHaveLength(1);
		expect(read).toHaveBeenCalledTimes(2);
		expect(store.of({ key: "a", runStamp: "1", mayQueue: true }, read)).toBeUndefined();
		expect(read).toHaveBeenCalledTimes(3);
	});
});
