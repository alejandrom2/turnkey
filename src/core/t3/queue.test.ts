import { describe, expect, it } from "vitest";

import { EMPTY_QUEUE, queuePress, threadQueue } from "./queue.js";

const run = (id: string, ordinal: number, status: string, patch: Record<string, unknown> = {}) => ({ id, ordinal, userMessageId: `m-${id}`, status, ...patch });
const message = (id: string, text: string, patch: Record<string, unknown> = {}) => ({ id: `m-${id}`, text, ...patch });

describe("threadQueue", () => {
	it("lists queued messages in T3 Code's order, without automatic completions, guests in their own words", () => {
		const queue = threadQueue({
			runs: [run("a", 1, "completed"), run("b", 2, "queued", { queuePosition: 2 }), run("c", 3, "queued", { queuePosition: 1 }), run("d", 4, "queued"), run("e", 5, "queued")],
			messages: [message("b", "second"), message("c", "first"), message("d", "to the guest", { context: { guest: { text: "from the guest" } } }), message("e", "done", { notification: {} })],
		});
		expect(queue.items).toEqual([
			{ runId: "c", text: "first" },
			{ runId: "b", text: "second" },
			{ runId: "d", text: "from the guest" },
		]);
		expect(queue).toMatchObject({ activeRunId: null, canSendNow: true, canPromote: false, held: false });
	});

	it("can steer only into a running provider turn whose session takes steering", () => {
		const base = {
			thread: { id: "t", activeProviderThreadId: "pt" },
			runs: [run("a", 1, "running", { activeAttemptId: "att", providerThreadId: "pt" }), run("b", 2, "queued", { queueHeld: true })],
			messages: [message("b", "next")],
			providerThreads: [{ id: "pt", appThreadId: "t", providerSessionId: "s" }],
			providerSessions: [{ id: "s", status: "running", capabilities: { turns: { supportsActiveSteering: true } } }],
		};
		expect(threadQueue({ ...base, providerTurns: [{ runAttemptId: "att", status: "running" }] })).toMatchObject({ activeRunId: "a", canSendNow: false, canPromote: true, held: true });
		expect(threadQueue({ ...base, providerTurns: [{ runAttemptId: "att", status: "completed" }] }).canPromote).toBe(false);
		expect(
			threadQueue({ ...base, providerTurns: [{ runAttemptId: "att", status: "running" }], providerSessions: [{ id: "s", capabilities: { turns: {} } }] }).canPromote,
		).toBe(false);
	});
});

describe("queuePress", () => {
	it("starts a message while nothing runs, steers it into a steerable turn, else waits", () => {
		expect(queuePress({ ...EMPTY_QUEUE, canSendNow: true, held: true })).toBe("start");
		expect(queuePress({ ...EMPTY_QUEUE, activeRunId: "a", canPromote: true })).toBe("steer");
		expect(queuePress({ ...EMPTY_QUEUE, activeRunId: "a" })).toBeUndefined();
	});
});
