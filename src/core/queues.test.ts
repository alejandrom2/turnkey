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
		expect(store.of({ key: "a" }, read)).toBe(EMPTY_QUEUE);
		expect(read).not.toHaveBeenCalled();
	});

	it("reads once per stamp, keeps the last queue while a newer read runs, and catches up with a stamp that moved meanwhile", async () => {
		const { read, resolve } = reads();
		const onChange = vi.fn();
		const store = new QueueStore(onChange);
		expect(store.of({ key: "a", queueStamp: "1" }, read)).toBeUndefined();
		store.of({ key: "a", queueStamp: "1" }, read);
		expect(read).toHaveBeenCalledTimes(1);
		store.of({ key: "a", queueStamp: "2" }, read);
		expect(read).toHaveBeenCalledTimes(1);
		await resolve(queue("first"));
		expect(onChange).toHaveBeenCalled();
		expect(read).toHaveBeenCalledTimes(2);
		expect(store.of({ key: "a", queueStamp: "2" }, read)?.items.map((item) => item.text)).toEqual(["first"]);
		await resolve(queue("first", "second"));
		expect(store.of({ key: "a", queueStamp: "2" }, read)?.items).toHaveLength(2);
		expect(read).toHaveBeenCalledTimes(2);
	});

	it("reads again after the deck changed the queue, even mid-read", async () => {
		const { read, resolve } = reads();
		const store = new QueueStore(() => undefined);
		store.of({ key: "a", queueStamp: "1" }, read);
		store.invalidate("a");
		await resolve(queue("old"));
		expect(read).toHaveBeenCalledTimes(2);
		await resolve(queue());
		expect(store.of({ key: "a", queueStamp: "1" }, read)?.items).toEqual([]);
		expect(read).toHaveBeenCalledTimes(2);
	});
});
