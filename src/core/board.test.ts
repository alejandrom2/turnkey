import { describe, expect, it } from "vitest";

import { type BoardSource, deckState, ThreadBoard } from "./board.js";
import type { ConnectionState } from "./connection.js";
import type { ThreadListItem, ThreadStatus } from "./t3.js";

type FakeThread = Partial<ThreadListItem> & { threadId: string; status: ThreadStatus; pending?: number; questions?: number };

function fakeSource(threads: FakeThread[]) {
	const calls: { name: string; args: Record<string, unknown> }[] = [];
	const source: BoardSource & { threads: FakeThread[]; calls: typeof calls } = {
		url: "http://localhost:3773/mcp",
		state: { kind: "ready", environmentId: "env-1", label: "Laptop", canOperate: true } satisfies ConnectionState,
		threads,
		calls,
		async call<T>(name: string, args: Record<string, unknown>): Promise<T> {
			calls.push({ name, args });
			const find = () => source.threads.find((thread) => thread.threadId === args.threadId)!;
			switch (name) {
				case "t3_project_list":
					return { projects: [{ id: "p1", title: "t3code" }], nextCursor: null } as T;
				case "t3_thread_list":
					return {
						threads: source.threads.map((thread) => ({
							title: thread.threadId,
							latestRunId: null,
							providerInstanceId: "codex",
							model: "gpt-5.5",
							parentThreadId: null,
							updatedAt: "2026-10-26T00:00:00Z",
							...thread,
						})),
					} as T;
				case "t3_thread_read":
					return { pendingRequestCount: find().pending ?? 0 } as T;
				case "t3_pending_request":
					return { requestIds: Array.from({ length: find().questions ?? 0 }, (_, i) => `r${i}`) } as T;
				case "t3_thread_wait":
					return new Promise<T>(() => undefined);
				default:
					throw new Error(`unexpected ${name}`);
			}
		},
	};
	return source;
}

describe("deckState", () => {
	it("puts the user's blockers before run status", () => {
		expect(deckState("running", 1, 0)).toBe("approval");
		expect(deckState("running", 0, 2)).toBe("question");
	});

	it("treats a finished turn that is still draining as done", () => {
		expect(deckState("waiting", 0, 0)).toBe("done");
		expect(deckState("interrupted", 0, 0)).toBe("stopped");
		expect(deckState("rolled_back", 0, 0)).toBe("idle");
	});
});

describe("ThreadBoard", () => {
	it("splits pending requests into questions and approvals", async () => {
		const source = fakeSource([
			{ threadId: "asks", status: "running", pending: 1, questions: 1 },
			{ threadId: "approves", status: "running", pending: 2, questions: 0 },
		]);
		const board = new ThreadBoard(() => [source]);
		await board.refresh();
		const byId = Object.fromEntries(board.threads.map((thread) => [thread.threadId, thread]));
		expect(byId.asks.deck).toBe("question");
		expect(byId.approves).toMatchObject({ deck: "approval", approvals: 2 });
		expect(board.threads[0].threadId).toBe("approves");
	});

	it("never reads delegated children or idle threads", async () => {
		const source = fakeSource([
			{ threadId: "child", status: "running", parentThreadId: "parent" },
			{ threadId: "quiet", status: "idle" },
		]);
		await new ThreadBoard(() => [source]).refresh();
		expect(source.calls.filter((call) => call.name === "t3_thread_read")).toEqual([]);
	});

	it("marks a turn that finishes while watched as unseen until opened", async () => {
		const source = fakeSource([{ threadId: "t", status: "running" }]);
		const board = new ThreadBoard(() => [source], { now: () => 1_000 });
		await board.refresh();
		expect(board.threads[0]).toMatchObject({ deck: "running", activeSince: 1_000, unseen: false });

		source.threads = [{ threadId: "t", status: "completed" }];
		await board.refresh();
		expect(board.threads[0]).toMatchObject({ deck: "done", unseen: true });

		board.markSeen(board.threads[0].key);
		expect(board.threads[0].unseen).toBe(false);
	});

	it("does not flood the deck with turns that finished before it started watching", async () => {
		const board = new ThreadBoard(() => [fakeSource([{ threadId: "old", status: "completed" }])]);
		await board.refresh();
		expect(board.threads[0].unseen).toBe(false);
	});

	it("moves focus within the list and clamps at the ends", async () => {
		const source = fakeSource([
			{ threadId: "a", status: "running", pending: 1, questions: 1 },
			{ threadId: "b", status: "running" },
			{ threadId: "c", status: "idle" },
		]);
		const board = new ThreadBoard(() => [source]);
		await board.refresh();
		expect(board.focused?.threadId).toBe("a");
		board.moveFocus(5);
		expect(board.focused?.threadId).toBe("c");
		board.moveFocus(-1);
		expect(board.focused?.threadId).toBe("b");
	});

	it("re-reads only projects with an active thread between full passes", async () => {
		let now = 0;
		const source = fakeSource([{ threadId: "quiet", status: "idle" }]);
		const board = new ThreadBoard(() => [source], { now: () => now, idleIntervalMs: 15_000 });
		await board.refresh();
		now = 2_000;
		await board.refresh();
		expect(source.calls.filter((call) => call.name === "t3_thread_list")).toHaveLength(1);

		await board.refresh(true);
		expect(source.calls.filter((call) => call.name === "t3_thread_list")).toHaveLength(2);
	});

	it("skips environments that are not signed in", async () => {
		const source = fakeSource([{ threadId: "t", status: "running" }]);
		const signedOut = { ...source, state: { kind: "signed-out" } as ConnectionState };
		const board = new ThreadBoard(() => [signedOut]);
		await board.refresh();
		expect(board.threads).toEqual([]);
		expect(source.calls).toEqual([]);
	});
});
