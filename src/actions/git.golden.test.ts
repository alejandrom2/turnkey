import { beforeEach, describe, it, vi } from "vitest";

import { CommitKey, CreatePrKey, GitKey, PullKey, PushKey } from "./git.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, RUNNING, scene, STATES } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

// The key sends a random action id with a stacked action.
beforeEach(() => void vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000"));

type Setup = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>, held?: number | number[]];

const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};
const presses = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings, held] of setups) it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
};

/** T3 Code's `vcs.refreshStatus` for a checkout with two changed files and one commit to push. */
const status = (overrides: Record<string, unknown> = {}) => ({
	isRepo: true,
	hasPrimaryRemote: true,
	isDefaultRef: false,
	refName: "feat/x",
	hasWorkingTreeChanges: true,
	workingTree: { files: [{}, {}], insertions: 4, deletions: 1 },
	hasUpstream: true,
	aheadCount: 1,
	behindCount: 0,
	aheadOfDefaultCount: 1,
	pr: null,
	...overrides,
});
const CLEAN = { hasWorkingTreeChanges: false, workingTree: { files: [], insertions: 0, deletions: 0 } };

const finished = (action: string, extra: Record<string, unknown> = {}) => ({ kind: "action_finished", result: { action, pr: { status: "skipped_not_requested" }, toast: { title: "Done" }, ...extra } });
const PROGRESS = [{ kind: "action_started" }, { kind: "phase_started", label: "Committing" }, { kind: "hook_started", hookName: "pre-commit" }];

type Overrides = { status?: Record<string, unknown> | Error; stream?: unknown[]; machine?: Parameters<typeof machine>[0]; id?: string; rpc?: Record<string, unknown> };
/** A selected thread on a branch, whose checkout reports `status`; `stream` is the stacked action's progress. */
const repo = ({ status: reported = status(), stream = [...PROGRESS, finished("commit")], machine: extra = {}, id = "git-1", rpc = {} }: Overrides = {}): GoldenOptions =>
	scene({ threadId: id, branch: "feat/x" }, { rpc: { "vcs.refreshStatus": reported, "vcs.pull": { status: "pulled", refName: "feat/x" }, ...rpc }, streams: { "git.runStackedAction": stream }, ...extra });

const connection: Setup[] = [
	["none", STATES.none],
	["offline", STATES.offline],
	["no-thread", STATES["no-thread"]],
	["read-only", () => scene({ branch: "feat/x" }, { canOperate: false })],
	["no-access", () => repo({ machine: { scopes: ["orchestration:read", "orchestration:operate"] } })],
	["no-folder", () => repo({ machine: { project: () => undefined } })],
	["not-a-repo", () => repo({ status: status({ isRepo: false }) })],
	["status-unread", () => repo({ status: new Error("boom") })],
];

const ACTIONS = ["commit", "commit_push", "commit_push_pr", "push", "create_pr", "pull"] as const;

describe("Git goldens", () => {
	faces("git", GitKey, [
		...connection,
		...ACTIONS.map((gitAction): Setup => [`${gitAction}`, () => repo(), { gitAction }]),
		["titled", () => repo(), { gitAction: "commit", title: "Save" }],
		["commit-one-file", () => repo({ status: status({ workingTree: { files: [{}], insertions: 2, deletions: 0 } }) }), { gitAction: "commit" }],
		["commit-clean", () => repo({ status: status(CLEAN) }), { gitAction: "commit" }],
		["push-uncommitted", () => repo(), { gitAction: "push" }],
		["push-ahead", () => repo({ status: status(CLEAN) }), { gitAction: "push" }],
		["push-nothing", () => repo({ status: status({ ...CLEAN, aheadCount: 0 }) }), { gitAction: "push" }],
		["push-behind", () => repo({ status: status({ ...CLEAN, behindCount: 2 }) }), { gitAction: "push" }],
		["push-no-remote", () => repo({ status: status({ ...CLEAN, hasUpstream: false, hasPrimaryRemote: false }) }), { gitAction: "push" }],
		["push-detached", () => repo({ status: status({ ...CLEAN, refName: null }) }), { gitAction: "push" }],
		["push-default-branch", () => repo({ status: status({ ...CLEAN, isDefaultRef: true, refName: "main" }) }), { gitAction: "push" }],
		["pr-ahead", () => repo({ status: status(CLEAN) }), { gitAction: "create_pr" }],
		["pr-open", () => repo({ status: status({ ...CLEAN, pr: { number: 7, state: "open", url: "https://example.test/pr/7" } }) }), { gitAction: "create_pr" }],
		["pr-default-branch", () => repo({ status: status({ ...CLEAN, isDefaultRef: true, refName: "main" }) }), { gitAction: "create_pr" }],
		["pr-nothing", () => repo({ status: status({ ...CLEAN, aheadOfDefaultCount: 0, aheadCount: 0 }) }), { gitAction: "create_pr" }],
		["pull-behind", () => repo({ status: status({ ...CLEAN, behindCount: 2, aheadCount: 0 }) }), { gitAction: "pull" }],
		["pull-up-to-date", () => repo({ status: status(CLEAN) }), { gitAction: "pull" }],
		["pull-diverged", () => repo({ status: status({ ...CLEAN, behindCount: 2 }) }), { gitAction: "pull" }],
		["pull-no-upstream", () => repo({ status: status({ ...CLEAN, hasUpstream: false }) }), { gitAction: "pull" }],
	]);

	faces("git-legacy", CommitKey, [["dirty", () => repo()]]);
	faces("git-legacy-push", PushKey, [["ahead", () => repo({ status: status(CLEAN) })]]);
	faces("git-legacy-pr", CreatePrKey, [["ahead", () => repo({ status: status(CLEAN) })]]);
	faces("git-legacy-pull", PullKey, [["behind", () => repo({ status: status({ ...CLEAN, behindCount: 2, aheadCount: 0 }) })]]);

	const behind = () => repo({ status: status({ ...CLEAN, behindCount: 2, aheadCount: 0 }) });
	const ahead = (extra: Overrides = {}) => repo({ status: status(CLEAN), stream: [...PROGRESS, finished("push")], ...extra });
	presses("git", GitKey, [
		["commit", () => repo(), { gitAction: "commit" }],
		["commit-message", () => repo(), { gitAction: "commit", commitMessage: "wip" }],
		["commit-hold-setting-tap", () => repo(), { gitAction: "commit", confirm: "hold" }],
		["commit-hold-setting-held", () => repo(), { gitAction: "commit", confirm: "hold" }, 600],
		["commit-push-tap", () => repo(), { gitAction: "commit_push" }],
		["commit-push-held", () => repo({ stream: [...PROGRESS, finished("commit_push")] }), { gitAction: "commit_push" }, 600],
		["commit-push-pr-held", () => repo({ stream: [...PROGRESS, finished("commit_push_pr", { pr: { status: "created", number: 9 } })] }), { gitAction: "commit_push_pr" }, 600],
		["commit-clean", () => repo({ status: status(CLEAN) }), { gitAction: "commit" }],
		["push-tap", () => ahead(), { gitAction: "push" }],
		["push-held", () => ahead(), { gitAction: "push" }, 600],
		["push-tap-setting", () => ahead(), { gitAction: "push", confirm: "tap" }],
		["push-default-branch-tap", () => ahead({ status: status({ ...CLEAN, isDefaultRef: true, refName: "main" }) }), { gitAction: "push", confirm: "tap" }],
		["push-default-branch-held", () => ahead({ status: status({ ...CLEAN, isDefaultRef: true, refName: "main" }) }), { gitAction: "push", confirm: "tap" }, 600],
		["push-failed", () => ahead({ stream: [{ kind: "action_started" }, { kind: "action_failed", message: "remote rejected the push" }] }), { gitAction: "push" }, 600],
		["pr-held", () => ahead({ stream: [...PROGRESS, finished("create_pr", { pr: { status: "created", number: 9 } })] }), { gitAction: "create_pr" }, 600],
		["pr-open", () => ahead({ status: status({ ...CLEAN, pr: { number: 7, state: "open", url: "https://example.test/pr/7" } }) }), { gitAction: "create_pr" }, 600],
		["pull", behind, { gitAction: "pull" }],
		["pull-held", behind, { gitAction: "pull" }, 600],
		["pull-up-to-date", () => repo({ status: status(CLEAN) }), { gitAction: "pull" }],
		["pull-failed", () => repo({ status: status({ ...CLEAN, behindCount: 2, aheadCount: 0 }), rpc: { "vcs.pull": new Error("not fast-forward") } }), { gitAction: "pull" }],
		["status-failed", () => repo({ status: new Error("boom") }), { gitAction: "commit" }],
		["no-thread", STATES["no-thread"], { gitAction: "commit" }],
		["read-only", () => scene({ branch: "feat/x" }, { canOperate: false }), { gitAction: "commit" }],
		["no-access", () => repo({ machine: { scopes: ["orchestration:read", "orchestration:operate"] } }), { gitAction: "commit" }],
		["not-a-repo", () => repo({ status: status({ isRepo: false }) }), { gitAction: "commit" }],
		["offline", STATES.offline, { gitAction: "commit" }],
		["running", () => scene({ branch: "feat/x", ...RUNNING }, { rpc: { "vcs.refreshStatus": status() }, streams: { "git.runStackedAction": [...PROGRESS, finished("commit")] } }), { gitAction: "commit" }],
	]);
	presses("git-legacy", CommitKey, [["commit", () => repo()]]);
	presses("git-legacy-push", PushKey, [["held", ahead, undefined, 600]]);
	presses("git-legacy-pr", CreatePrKey, [["held", () => ahead({ stream: [...PROGRESS, finished("create_pr")] }), undefined, 600]]);
	presses("git-legacy-pull", PullKey, [["pull", behind]]);
});
