import { describe, expect, it } from "vitest";

import { applyShellItem, nextSnoozeWake, type ProjectShell, type ShellItem, shellRows, type ShellState, type ThreadCapabilities, type ThreadShell } from "./shell.js";

const project: ProjectShell = { id: "p-1", title: "app", workspaceRoot: "/Users/me/code/app", repositoryIdentity: null, defaultModelSelection: null };

/** The spec's example `thread.updated` row, trimmed to fields the deck reads. */
function thread(patch: Partial<ThreadShell> & { id: string }): ThreadShell {
	return {
		projectId: "p-1",
		title: patch.id,
		modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] },
		runtimeMode: "approval-required",
		interactionMode: "default",
		branch: null,
		pullRequests: [],
		lineage: { parentThreadId: null, relationshipToParent: null },
		activeProviderThreadId: null,
		latestRunId: null,
		latestRunRequestedAt: null,
		latestRunStartedAt: null,
		latestRunCompletedAt: null,
		activeRunId: null,
		activityRunStartedAt: null,
		activityRunStatus: null,
		status: "idle",
		lastErrorClass: null,
		pendingRuntimeRequest: null,
		pendingGuestMessageCount: 0,
		pendingBackgroundTasks: [],
		updatedAt: "2026-10-26T14:00:00.000Z",
		settledOverride: null,
		snoozedUntil: null,
		snoozedAt: null,
		pinnedAt: null,
		lastVisitedAt: "2026-10-26T13:00:00.000Z",
		deletedAt: null,
		...patch,
	};
}

const running = (id: string, patch: Partial<ThreadShell> = {}) =>
	thread({
		id,
		latestRunId: `run:thread:${id}:ordinal:4`,
		activeRunId: `run:thread:${id}:ordinal:4`,
		latestRunStartedAt: "2026-10-26T14:00:02.100Z",
		activityRunStartedAt: "2026-10-26T14:00:02.100Z",
		activityRunStatus: "running",
		status: "running",
		...patch,
	});

const finished = (id: string, status: ThreadShell["status"], completedAt: string, patch: Partial<ThreadShell> = {}) =>
	thread({ id, latestRunId: `run:${id}`, status, latestRunCompletedAt: completedAt, updatedAt: completedAt, ...patch });

const snapshot = (threads: ThreadShell[], snapshotSequence = 100): ShellItem => ({
	kind: "snapshot",
	snapshot: { snapshotSequence, projects: [project], threads },
});

function reduce(items: ShellItem[]): ShellState {
	const state = items.reduce<ShellState | undefined>((current, item) => applyShellItem(current, item), undefined);
	if (state === undefined) throw new Error("no snapshot");
	return state;
}

const NOW = Date.parse("2026-10-26T15:00:00.000Z");
const rows = (state: ShellState, capabilities: ThreadCapabilities = { threadSettlement: true, threadSnooze: true }) => shellRows(state, capabilities, NOW);
const byId = (state: ShellState) => Object.fromEntries(rows(state).map((row) => [row.threadId, row]));

describe("applyShellItem", () => {
	it("replaces the list on an authoritative snapshot and applies whole-row deltas", () => {
		const state = reduce([
			snapshot([thread({ id: "a" }), thread({ id: "b" })]),
			{ kind: "synchronized" },
			{ kind: "thread.updated", sequence: 101, location: "active", thread: running("a", { title: "Fix flaky shell resume test" }) },
			{ kind: "thread.removed", sequence: 102, location: "active", threadId: "b" },
		]);
		expect(state.seq).toBe(102);
		expect(state.synced).toBe(true);
		expect(rows(state).map((row) => [row.threadId, row.title, row.projectTitle])).toEqual([["a", "Fix flaky shell resume test", "app"]]);
	});

	it("keeps threads through the project-only snapshot a resume sends", () => {
		const state = reduce([
			snapshot([thread({ id: "a" })], 184223),
			{
				kind: "snapshot",
				snapshot: { snapshotSequence: 184223, projects: [{ ...project, repositoryIdentity: { remote: "x" } }], threads: [] },
				resolvedRepositoryIdentityRoots: ["/Users/me/code/app"],
			},
		]);
		expect(state.threads.size).toBe(1);
		expect(state.seq).toBe(184223);
	});

	it("ignores stale and duplicate deltas, and deltas before any snapshot", () => {
		expect(applyShellItem(undefined, { kind: "thread.removed", sequence: 5, location: "active", threadId: "a" })).toBeUndefined();
		const base = reduce([snapshot([thread({ id: "a", title: "current" })], 200)]);
		const stale = applyShellItem(base, { kind: "thread.updated", sequence: 200, location: "active", thread: thread({ id: "a", title: "old" }) });
		expect(stale).toBe(base);
		expect(applyShellItem(base, { kind: "thread.removed", sequence: 150, location: "active", threadId: "a" })).toBe(base);
	});

	it("drops a thread updated into the archive and forgets removed projects", () => {
		const state = reduce([
			snapshot([thread({ id: "a" })]),
			{ kind: "thread.updated", sequence: 101, location: "archive", thread: thread({ id: "a" }) },
			{ kind: "project.removed", sequence: 102, projectId: "p-1" },
		]);
		expect(state.threads.size).toBe(0);
		expect(state.projects.size).toBe(0);
	});

	it("ignores kinds it does not know but keeps the cursor moving", () => {
		const base = reduce([snapshot([thread({ id: "a" })], 10)]);
		const next = applyShellItem(base, { kind: "project.reordered", sequence: 11 } as unknown as ShellItem);
		expect(next?.seq).toBe(11);
		expect(next?.threads).toBe(base.threads);
	});
});

describe("deck status", () => {
	it("follows T3 Code's priority: approval, question, running, queued or parked, failed, stopped, done, idle", () => {
		const state = reduce([
			snapshot([
				running("approval", { pendingRuntimeRequest: { id: "rr-1", kind: "command", createdAt: "2026-10-26T14:03:11.412Z", blocking: true } }),
				running("question", { pendingRuntimeRequest: { id: "rr-2", kind: "user_input", createdAt: "2026-10-26T14:03:11.412Z" } }),
				running("running"),
				running("draining", { activityRunStatus: "waiting", status: "waiting" }),
				thread({ id: "queued", latestRunId: "run:q", status: "queued", activityRunStatus: null }),
				finished("failed", "failed", "2026-10-26T14:10:00.000Z"),
				finished("stopped", "interrupted", "2026-10-26T14:10:00.000Z"),
				finished("done", "completed", "2026-10-26T14:10:00.000Z"),
				thread({ id: "parked", latestRunId: "run:p", status: "completed", latestRunCompletedAt: "2026-10-26T14:10:00.000Z", pendingBackgroundTasks: [{ kind: "subagent" }] }),
				thread({ id: "idle" }),
				thread({ id: "attached", activeProviderThreadId: "provider-thread:x" }),
			]),
		]);
		const deck = Object.fromEntries(rows(state).map((row) => [row.threadId, row.deck]));
		expect(deck).toEqual({
			approval: "approval",
			question: "question",
			running: "running",
			draining: "running",
			queued: "queued",
			failed: "failed",
			stopped: "stopped",
			done: "done",
			parked: "queued",
			idle: "idle",
			attached: "idle",
		});
	});

	it("lets a running turn work past a non-blocking question", () => {
		const state = reduce([snapshot([running("a", { pendingRuntimeRequest: { id: "rr", kind: "user_input", createdAt: "x", blocking: false } })])]);
		expect(byId(state).a).toMatchObject({ deck: "running", pendingRequest: undefined });
	});

	it("times the run from when its work started", () => {
		const row = byId(reduce([snapshot([running("a")])])).a;
		expect(row).toMatchObject({ active: true, activeSince: Date.parse("2026-10-26T14:00:02.100Z") });
	});

	it("surfaces a delegated child's approval on its parent, answered as the child", () => {
		const child = running("child", {
			lineage: { parentThreadId: "parent", relationshipToParent: "subagent" },
			creationSource: "web",
			pendingRuntimeRequest: { id: "rr-child", kind: "file-change", createdAt: "x", blocking: true },
		});
		const state = reduce([snapshot([running("parent", { pendingRuntimeRequest: { id: "rr-q", kind: "user_input", createdAt: "x" } }), child])]);
		const listed = rows(state);
		expect(listed.map((row) => row.threadId)).toEqual(["parent"]);
		expect(listed[0]).toMatchObject({ deck: "approval", pendingRequest: { id: "rr-child", threadId: "child" } });
	});

	it("counts the subagents a turn has out, as T3 Code's background work banner does, and nothing else", () => {
		const tasks = [
			{ taskId: "1", kind: "subagent" },
			{ taskId: "2", kind: "subagent", awaited: true },
			{ taskId: "3", kind: "command" },
		];
		const state = reduce([snapshot([running("a", { pendingBackgroundTasks: tasks }), running("b")])]);
		expect(byId(state).a?.subagents).toBe(2);
		expect(byId(state).b?.subagents).toBe(0);
	});
});

describe("unread", () => {
	const visited = "2026-10-26T14:05:00.000Z";

	it("marks a completion after the last visit unseen, and a never-visited completion read", () => {
		const state = reduce([
			snapshot([
				finished("new", "completed", "2026-10-26T14:10:00.000Z", { lastVisitedAt: visited }),
				finished("seen", "completed", "2026-10-26T14:00:00.000Z", { lastVisitedAt: visited }),
				finished("imported", "completed", "2026-10-26T14:10:00.000Z", { lastVisitedAt: null }),
			]),
		]);
		expect(Object.fromEntries(rows(state).map((row) => [row.threadId, row.unseen]))).toEqual({ new: true, seen: false, imported: false });
	});

	it("treats a never-visited failure as unseen", () => {
		const row = byId(reduce([snapshot([finished("f", "failed", "2026-10-26T14:10:00.000Z", { lastVisitedAt: null })])])).f;
		expect(row).toMatchObject({ deck: "failed", unseen: true });
	});
});

describe("selection marker", () => {
	it("follows the server's open stamp, and the read watermark only on servers without one", () => {
		const state = reduce([
			snapshot([
				thread({ id: "opened", opens: { openedAt: 1_000 }, lastVisitedAt: "2026-10-26T14:05:00.000Z" }),
				thread({ id: "never-opened", opens: null }),
				thread({ id: "old-server", lastVisitedAt: "2026-10-26T14:05:00.000Z" }),
			]),
		]);
		const byThread = byId(state);
		expect(byThread.opened.openedAt).toBe(1_000);
		expect(byThread["never-opened"].openedAt).toBeUndefined();
		expect(byThread["old-server"].openedAt).toBe(Date.parse("2026-10-26T14:05:00.000Z"));
	});
});

describe("listing", () => {
	it("hides settled and snoozed threads only where the server supports them", () => {
		const state = reduce([
			snapshot([
				thread({ id: "settled", settledOverride: "settled" }),
				thread({ id: "snoozed", snoozedUntil: "2026-10-26T16:00:00.000Z", snoozedAt: "2026-10-26T14:00:00.000Z" }),
				thread({ id: "woke", snoozedUntil: "2026-10-26T14:30:00.000Z" }),
				thread({ id: "deleted", deletedAt: "2026-10-26T14:30:00.000Z" }),
			]),
		]);
		expect(rows(state).map((row) => row.threadId)).toEqual(["woke"]);
		expect(rows(state, {}).map((row) => row.threadId).sort()).toEqual(["settled", "snoozed", "woke"]);
		// A key pinned to one thread follows it while settled or snoozed, never once deleted.
		expect(shellRows(state, { threadSettlement: true, threadSnooze: true }, NOW, true).map((row) => row.threadId).sort()).toEqual(["settled", "snoozed", "woke"]);
		expect(nextSnoozeWake(state, NOW)).toBe(Date.parse("2026-10-26T16:00:00.000Z"));
	});

	it("wakes a snoozed thread early when it raises a hand", () => {
		const state = reduce([
			snapshot([
				running("asks", {
					snoozedUntil: "2026-10-26T16:00:00.000Z",
					pendingRuntimeRequest: { id: "rr", kind: "command", createdAt: "x" },
				}),
			]),
		]);
		expect(rows(state).map((row) => row.threadId)).toEqual(["asks"]);
	});
});
