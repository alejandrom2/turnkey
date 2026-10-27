import { describe, expect, it } from "vitest";

import { type GitMachine, gitBlocker, gitCwd, gitSummary, needsDefaultBranchHold, pull, readStatus, reasonText, runStackedAction, stackedActionInput, type VcsStatus } from "./git.js";
import { RpcError } from "./t3/rpc.js";

const STATUS: VcsStatus = {
	isRepo: true,
	hasPrimaryRemote: true,
	isDefaultRef: false,
	refName: "feature/deck",
	hasWorkingTreeChanges: true,
	workingTree: { files: [{}, {}, {}], insertions: 12, deletions: 4 },
	hasUpstream: true,
	aheadCount: 0,
	behindCount: 0,
	aheadOfDefaultCount: 2,
	pr: null,
};

const reason = (status: Partial<VcsStatus>, action: Parameters<typeof gitBlocker>[1]) => {
	const blocker = gitBlocker({ ...STATUS, ...status }, action);
	return blocker && reasonText(blocker);
};

function fakeMachine(events: unknown[] = [], end?: Error) {
	const calls: { tag: string; payload: unknown; scope?: string }[] = [];
	const machine: GitMachine = {
		async call<T>(tag: string, payload: unknown, scope?: string) {
			calls.push({ tag, payload, scope });
			return { status: "pulled", refName: "main" } as T;
		},
		async stream(tag, payload, onValue, scope) {
			calls.push({ tag, payload, scope });
			for (const event of events) onValue(event);
			if (end) throw end;
		},
	};
	return { machine, calls };
}

describe("git payloads", () => {
	it("send T3 Code's runStackedAction input, with the thread and a trimmed message only when set", () => {
		expect(stackedActionInput({ actionId: "a-1", cwd: "/w/app", action: "commit_push", commitMessage: "  fix: deck  ", threadId: "thr_1" })).toEqual({
			actionId: "a-1",
			cwd: "/w/app",
			action: "commit_push",
			commitMessage: "fix: deck",
			threadId: "thr_1",
		});
		expect(stackedActionInput({ actionId: "a-2", cwd: "/w/app", action: "push", commitMessage: " " })).toEqual({ actionId: "a-2", cwd: "/w/app", action: "push" });
	});

	it("run in the thread's worktree, else the project's root", () => {
		expect(gitCwd({ worktreePath: "/w/app-feature" }, "/w/app")).toBe("/w/app-feature");
		expect(gitCwd({}, "/w/app")).toBe("/w/app");
	});

	it("read status locally for faces and with the remote on a press, and pull under source control access", async () => {
		const { machine, calls } = fakeMachine();
		await readStatus(machine, "/w/app", false);
		await readStatus(machine, "/w/app", true);
		await pull(machine, "/w/app");
		expect(calls).toEqual([
			{ tag: "vcs.refreshStatus", payload: { cwd: "/w/app", localOnly: true }, scope: "orchestration:read" },
			{ tag: "vcs.refreshStatus", payload: { cwd: "/w/app" }, scope: "orchestration:read" },
			{ tag: "vcs.pull", payload: { cwd: "/w/app" }, scope: "source-control:write" },
		]);
	});
});

describe("runStackedAction", () => {
	const result = { action: "commit", pr: { status: "skipped_not_requested" }, toast: { title: "Committed abc1234", cta: { kind: "none" } } };

	it("streams progress and returns T3 Code's result", async () => {
		const { machine, calls } = fakeMachine([{ kind: "action_started" }, { kind: "phase_started", label: "Committing..." }, { kind: "action_finished", result }]);
		const labels: string[] = [];
		const done = await runStackedAction(machine, { actionId: "a", cwd: "/w/app", action: "commit" }, (event) => labels.push(event.kind));
		expect(done.toast.title).toBe("Committed abc1234");
		expect(labels).toEqual(["action_started", "phase_started", "action_finished"]);
		expect(calls[0]).toMatchObject({ tag: "git.runStackedAction", scope: "source-control:write" });
	});

	it("fails with T3 Code's message, and reports an unknown outcome when the socket drops first", async () => {
		await expect(runStackedAction(fakeMachine([{ kind: "action_failed", phase: "push", message: "Push rejected by the remote." }]).machine, { actionId: "a", cwd: "/w", action: "push" })).rejects.toMatchObject({
			reason: "Push rejected by the remote.",
		});
		await expect(runStackedAction(fakeMachine([{ kind: "action_started" }], new RpcError("Disconnected", "closed")).machine, { actionId: "a", cwd: "/w", action: "push" })).rejects.toMatchObject({
			tag: "Disconnected",
			reason: "Result unknown, check T3 Code",
		});
		await expect(runStackedAction(fakeMachine([]).machine, { actionId: "a", cwd: "/w", action: "push" })).rejects.toMatchObject({ reason: "Result unknown, check T3 Code" });
	});

	it("keeps the result when the stream errors after finishing", async () => {
		const { machine } = fakeMachine([{ kind: "action_finished", result }], new RpcError("Disconnected", "closed"));
		expect((await runStackedAction(machine, { actionId: "a", cwd: "/w", action: "commit" })).toast.title).toBe("Committed abc1234");
	});
});

describe("gitBlocker", () => {
	it("follows T3 Code's git menu for commit and push", () => {
		expect(reason({}, "commit")).toBeUndefined();
		expect(reason({ hasWorkingTreeChanges: false }, "commit")).toBe("Nothing to commit");
		expect(reason({}, "push")).toBe("Commit or stash changes first");
		expect(reason({ hasWorkingTreeChanges: false }, "push")).toBe("No commits to push");
		expect(reason({ hasWorkingTreeChanges: false, aheadCount: 2 }, "push")).toBeUndefined();
		expect(reason({ hasWorkingTreeChanges: false, aheadCount: 2, behindCount: 1 }, "push")).toBe("Behind upstream: pull first");
		expect(reason({ hasWorkingTreeChanges: false, aheadCount: 2, hasUpstream: false, hasPrimaryRemote: false }, "push")).toBe("Add an origin remote first");
		expect(reason({ refName: null }, "commit_push")).toBe("Detached HEAD: check out a branch");
		expect(reason({ isRepo: false }, "commit")).toBe("Not a git repository");
	});

	it("refuses a PR that is already open or would come from the default branch", () => {
		expect(reason({ hasWorkingTreeChanges: false }, "create_pr")).toBeUndefined();
		expect(reason({ hasWorkingTreeChanges: false, aheadOfDefaultCount: 0 }, "create_pr")).toBe("No commits for a PR");
		expect(reason({ pr: { number: 7, state: "open", url: "https://github.com/a/b/pull/7" } }, "commit_push_pr")).toBe("PR #7 is open");
		expect(reason({ isDefaultRef: true, refName: "main" }, "commit_push_pr")).toBe("On main: create a branch first");
		expect(reason({ isDefaultRef: true, refName: "main" }, "commit_push")).toBeUndefined();
	});

	it("pulls only a branch that is behind and hasn't diverged", () => {
		expect(reason({ behindCount: 2 }, "pull")).toBeUndefined();
		expect(reason({}, "pull")).toBe("Up to date");
		expect(reason({ behindCount: 1, aheadCount: 1 }, "pull")).toBe("Diverged: rebase or merge first");
		expect(reason({ hasUpstream: false }, "pull")).toBe("No upstream branch");
	});

	it("asks for a hold to push on the default branch, and summarizes what a key acts on", () => {
		expect(needsDefaultBranchHold({ ...STATUS, isDefaultRef: true }, "commit_push")).toBe(true);
		expect(needsDefaultBranchHold({ ...STATUS, isDefaultRef: true }, "commit")).toBe(false);
		expect(gitSummary(STATUS, "commit")).toBe("3 files · +12 −4");
		expect(gitSummary({ ...STATUS, hasWorkingTreeChanges: false, aheadCount: 2 }, "push")).toBe("2 ahead");
		expect(gitSummary({ ...STATUS, behindCount: 3 }, "pull")).toBe("3 behind");
	});
});
