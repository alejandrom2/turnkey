import { describe, expect, it, vi } from "vitest";

import { type BoardMachine, SELECT_DEBOUNCE_MS, ThreadBoard } from "./board.js";
import type { MachineState } from "./t3/machine.js";
import type { ShellRow } from "./t3/shell.js";

function row(threadId: string, patch: Partial<ShellRow> = {}): ShellRow {
	return {
		threadId,
		projectId: "p",
		projectTitle: "app",
		title: threadId,
		deck: "idle",
		runStatus: "idle",
		active: false,
		activeSince: undefined,
		activeRunId: null,
		unseen: false,
		pinned: false,
		model: { instanceId: "codex", model: "gpt-5.5" },
		runtimeMode: "full-access",
		interactionMode: "default",
		branch: undefined,
		pullRequests: [],
		pendingRequest: undefined,
		parentThreadId: null,
		updatedAt: 0,
		openedAt: undefined,
		runStamp: "",
		mayQueue: false,
		...patch,
	};
}

function machine(url: string, rows: ShellRow[], state: MachineState = { kind: "ready", environmentId: url, label: url, canOperate: true }) {
	const visit = vi.fn(async () => undefined);
	return { url, state, rows, visit, threadRow: (threadId: string) => rows.find((candidate) => candidate.threadId === threadId) ?? null } satisfies BoardMachine;
}

describe("ThreadBoard", () => {
	it("orders blockers, then running, queued, unseen results, then the rest by recency", () => {
		const board = new ThreadBoard(() => [
			machine("a", [
				row("old", { updatedAt: 1 }),
				row("seen-done", { deck: "done", updatedAt: 9 }),
				row("unseen-done", { deck: "done", unseen: true, updatedAt: 2 }),
				row("queued", { deck: "queued", active: true }),
				row("running-early", { deck: "running", active: true, activeSince: 100, updatedAt: 999 }),
				row("running-late", { deck: "running", active: true, activeSince: 200, updatedAt: 1 }),
			]),
			machine("b", [row("question", { deck: "question" }), row("approval", { deck: "approval" })]),
		]);
		board.update();
		expect(board.threads.map((thread) => thread.threadId)).toEqual(["approval", "question", "running-late", "running-early", "queued", "unseen-done", "seen-done", "old"]);
		expect(board.threads[0].key).toBe("b/approval");
	});

	it("leaves out machines that are not connected and filters by machine", () => {
		const board = new ThreadBoard(() => [machine("a", [row("x")]), machine("b", [row("y")], { kind: "connecting" })]);
		board.update();
		expect(board.threads.map((thread) => thread.key)).toEqual(["a/x"]);
		expect(board.threadsOn("b")).toEqual([]);
	});

	it("tells listeners only when something a key shows changed", () => {
		const rows = [row("x", { updatedAt: 1 })];
		const source = machine("a", rows);
		const board = new ThreadBoard(() => [source]);
		const listener = vi.fn();
		board.subscribe(listener);
		board.update();
		expect(listener).toHaveBeenCalledTimes(1);
		source.rows = [row("x", { updatedAt: 2 })];
		board.update();
		expect(listener).toHaveBeenCalledTimes(1);
		source.rows = [row("x", { title: "Renamed" })];
		board.update();
		expect(listener).toHaveBeenCalledTimes(2);
	});

	it("selects the thread opened last on each machine, and the latest selection across machines", () => {
		const a = machine("a", [row("a1", { openedAt: 100 }), row("a2", { openedAt: 300 }), row("a3")]);
		const b = machine("b", [row("b1", { openedAt: 50 })]);
		const board = new ThreadBoard(() => [a, b]);
		board.update();
		expect(board.selectedOn("a")?.key).toBe("a/a2");
		expect(board.selectedOn("b")?.key).toBe("b/b1");
		// Machines' clocks are never compared once running: a later open on b wins even with a smaller stamp.
		b.rows = [row("b1", { openedAt: 50 }), row("b2", { openedAt: 60 })];
		board.update();
		expect(board.selectedOn()?.key).toBe("b/b2");
		a.rows = [row("a1", { openedAt: 400 }), row("a2", { openedAt: 300 }), row("a3")];
		board.update();
		expect(board.selectedOn()?.key).toBe("a/a1");
		expect(board.selectedOn("b")?.key).toBe("b/b2");
	});

	it("falls back to the newest-opened listed thread, then the most urgent, when the selection is not listed", () => {
		const a = machine("a", [row("a1", { openedAt: 100 }), row("a2", { openedAt: 300 })]);
		const board = new ThreadBoard(() => [a]);
		board.update();
		a.rows = [row("a1", { openedAt: 100 })];
		board.update();
		expect(board.selectedOn()?.key).toBe("a/a1");
		const fresh = new ThreadBoard(() => [machine("a", [row("idle"), row("ask", { deck: "approval" })])]);
		fresh.update();
		expect(fresh.selectedOn()?.key).toBe("a/ask");
	});

	it("selects on the deck at once, visits with opened, and ignores the echo of its own visit", async () => {
		let now = 1_000;
		const a = machine("a", [row("a1", { openedAt: 100 }), row("a2", { openedAt: 200 }), row("a3")]);
		const board = new ThreadBoard(() => [a], () => now);
		board.update();
		await board.select("a/a1", "a");
		expect(board.selectedOn()?.key).toBe("a/a1");
		expect(a.visit).toHaveBeenCalledWith(expect.objectContaining({ threadId: "a1" }), { opened: true });
		await board.select("a/a3", "a");
		// The a1 open lands after the a3 pick: it is the deck's own echo, not a new selection.
		a.rows = [row("a1", { openedAt: 500 }), row("a2", { openedAt: 200 }), row("a3")];
		board.update();
		expect(board.selectedOn()?.key).toBe("a/a3");
		// A later open in T3 Code moves the selection again.
		now += 10_000;
		a.rows = [row("a1", { openedAt: 500 }), row("a2", { openedAt: 900 }), row("a3", { openedAt: 600 })];
		board.update();
		expect(board.selectedOn()?.key).toBe("a/a2");
	});

	it("takes the first open on a machine that had no stamps as a new selection", async () => {
		const a = machine("a", [row("a1", { openedAt: 100 })]);
		const b = machine("b", [row("b1"), row("b2")]);
		const board = new ThreadBoard(() => [a, b]);
		board.update();
		await board.select("a/a1", "a");
		b.rows = [row("b1"), row("b2", { openedAt: 5 })];
		board.update();
		expect(board.selectedOn()?.key).toBe("b/b2");
	});

	it("selects a launched thread once the shell lists it", async () => {
		const a = machine("a", [row("a1", { openedAt: 100 })]);
		const board = new ThreadBoard(() => [a]);
		board.update();
		await board.select("a/new", "a");
		expect(board.selectedOn()?.key).toBe("a/a1");
		a.rows = [row("a1", { openedAt: 100 }), row("new")];
		board.update();
		expect(board.selectedOn()?.key).toBe("a/new");
		expect(a.visit).not.toHaveBeenCalled();
	});

	it("shows a dial's pending choice at once and selects it once the dial rests", () => {
		vi.useFakeTimers();
		try {
			const a = machine("a", [row("a1", { deck: "approval", openedAt: 100 }), row("a2", { deck: "running" }), row("a3")]);
			const board = new ThreadBoard(() => [a]);
			board.update();
			const listener = vi.fn();
			board.subscribe(listener);
			board.step(1);
			board.step(5);
			expect(board.pendingOn()?.key).toBe("a/a3");
			expect(board.selectedOn()?.key).toBe("a/a1");
			expect(listener).toHaveBeenCalledTimes(2);
			vi.advanceTimersByTime(SELECT_DEBOUNCE_MS - 1);
			expect(a.visit).not.toHaveBeenCalled();
			vi.advanceTimersByTime(1);
			expect(a.visit).toHaveBeenCalledTimes(1);
			expect(a.visit).toHaveBeenCalledWith(expect.objectContaining({ threadId: "a3" }), { opened: true });
			expect(board.selectedOn()?.key).toBe("a/a3");
			expect(board.pendingOn()).toBeUndefined();
			// Turning back onto the selection cancels the pending choice without a visit.
			board.step(-1);
			board.step(1);
			vi.advanceTimersByTime(SELECT_DEBOUNCE_MS);
			expect(a.visit).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("steps a filtered dial from the thread it shows, which is the first match when the selection doesn't match", () => {
		vi.useFakeTimers();
		try {
			const a = machine("a", [row("a1", { deck: "approval" }), row("a2", { deck: "running" }), row("a3", { openedAt: 100 }), row("a4", { deck: "failed" })]);
			const board = new ThreadBoard(() => [a]);
			board.update();
			const attention = (thread: { deck: string }) => thread.deck === "approval" || thread.deck === "failed";
			expect(board.selectedOn()?.key).toBe("a/a3");
			expect(board.shownOn(undefined, attention)?.key).toBe("a/a1");
			board.step(1, undefined, attention);
			expect(board.shownOn(undefined, attention)?.key).toBe("a/a4");
			expect(board.pendingOn(undefined, (thread) => thread.deck === "running")).toBeUndefined();
			vi.advanceTimersByTime(SELECT_DEBOUNCE_MS);
			expect(a.visit).toHaveBeenCalledWith(expect.objectContaining({ threadId: "a4" }), { opened: true });
		} finally {
			vi.useRealTimers();
		}
	});

	it("finds a pinned thread while settled or snoozed, and reports it gone once its machine drops it", () => {
		const hidden = row("settled", { title: "Settled" });
		const owner = { ...machine("a", [row("x")]), threadRow: (threadId: string) => (threadId === "settled" ? hidden : null) };
		const board = new ThreadBoard(() => [owner, machine("b", [], { kind: "connecting" })]);
		board.update();
		expect(board.lookup("a/x")).toMatchObject({ state: "found", thread: { key: "a/x" } });
		expect(board.lookup("a/settled")).toMatchObject({ state: "found", thread: { key: "a/settled", title: "Settled", environmentId: "a" } });
		expect(board.lookup("a/archived")).toEqual({ state: "gone" });
		expect(board.lookup("b/y")).toEqual({ state: "unknown" });
	});
});
