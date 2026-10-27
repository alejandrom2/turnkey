import { describe, expect, it, vi } from "vitest";

import { type BoardMachine, ThreadBoard } from "./board.js";
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
		...patch,
	};
}

function machine(url: string, rows: ShellRow[], state: MachineState = { kind: "ready", environmentId: url, label: url, canOperate: true }) {
	const visit = vi.fn(async () => undefined);
	return { url, state, rows, visit } satisfies BoardMachine;
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

	it("moves focus within the list and clamps at the ends", () => {
		const board = new ThreadBoard(() => [machine("a", [row("a1", { deck: "approval" }), row("a2", { deck: "running" }), row("a3")])]);
		board.update();
		expect(board.focused?.threadId).toBe("a1");
		board.moveFocus(5);
		expect(board.focused?.threadId).toBe("a3");
		board.moveFocus(-1);
		expect(board.focused?.threadId).toBe("a2");
	});

	it("marks an unseen result read in T3 Code, and leaves read threads alone", async () => {
		const source = machine("a", [row("done", { deck: "done", unseen: true }), row("idle")]);
		const board = new ThreadBoard(() => [source]);
		board.update();
		await board.markSeen("a/done");
		await board.markSeen("a/idle");
		expect(source.visit).toHaveBeenCalledTimes(1);
		expect(source.visit).toHaveBeenCalledWith(expect.objectContaining({ threadId: "done" }));
	});
});
