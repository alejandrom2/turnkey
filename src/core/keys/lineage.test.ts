import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RUNNING, scene, STATES, thread } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import type { VcsStatus } from "../git.js";
import { t } from "../i18n.js";
import { stopFace } from "../ring.js";
import { resolveTarget, type TargetSettings } from "../target.js";
import type { KeyContext, KeyDefinition, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { branchKey, forkKey, stopKey } from "./lineage.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

// The clock the Stream Deck goldens were recorded at.
beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

/** A context as Stream Deck's test deck gives it, with the runtime's calls as spies. */
function context<S>(world: GoldenOptions, settings: S, gitStatus?: VcsStatus): KeyContext<S> {
	const threads = world.threads ?? [];
	const machines = world.machines ?? [...new Set(threads.map((each) => each.machine))];
	const runtime = {
		board: { threads, threadsOn: () => threads, selectedOn: () => world.selected },
		machines: () => machines,
		motion: () => "off",
		appearance: () => ({}),
		openThread: vi.fn(async () => undefined),
		openExternal: vi.fn(async () => undefined),
		selectThread: vi.fn(),
		scheme: () => undefined,
		gitStatus: () => gitStatus,
	} as unknown as KeyRuntime;
	const lookup = (key: string) => {
		const found = threads.find((each) => each.key === key);
		return found === undefined ? ({ state: "gone" } as const) : ({ state: "found", thread: found } as const);
	};
	return { settings, machine: undefined, runtime, target: () => resolveTarget<DeckThread>(settings as TargetSettings, () => world.selected, lookup) };
}

const face = <S, St>(key: KeyDefinition<S, St>, ctx: KeyContext<S>): string => decoded(key.tile(key.state(ctx), ctx));
const SETTINGS: PressInput = { heldMs: 0, confirmBy: "settings" };
const plan = <S, St>(key: KeyDefinition<S, St>, ctx: KeyContext<S>, input: PressInput = SETTINGS): PressPlan => key.press(key.state(ctx), ctx, input);

type Case = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>];
const connection: Case[] = [
	["no-thread", STATES["no-thread"]],
	["read-only", STATES["read-only"]],
];

/** Each face equals the golden Stream Deck's key recorded for it. */
function faces<S, St>(prefix: string, key: KeyDefinition<S, St>, cases: Case[]): void {
	it.each(cases)(`${prefix}-%s`, (name, make, settings) => expect(face(key, context(make(), (settings ?? {}) as S))).toBe(golden(`${prefix}-${name}`)));
}

/** Runs a press as Stream Deck's Confirm setting would let it, on the world's selected thread. */
async function pressed<S, St>(key: KeyDefinition<S, St>, world: GoldenOptions, settings: object = {}, input: PressInput = SETTINGS) {
	const ctx = context(world, settings as S);
	const result = plan(key, ctx, input);
	if (result.kind === "run") await result.work().catch(() => undefined);
	return { result, machine: world.selected?.machine, thread: world.selected, runtime: ctx.runtime };
}

const claude = (overrides: Partial<DeckThread> = {}) => scene({ model: { instanceId: "claudeAgent", model: "opus" }, ...overrides });
const PIN = { target: "thread", thread: "env/pinned-one", threadTitle: "Pinned one" };
const GONE = { target: "thread", thread: "env/gone", threadTitle: "Old thread" };
const pinned = (): GoldenOptions => {
	const base = scene({ threadId: "pinned-one", title: "Pinned one", ...RUNNING });
	return { threads: [...base.threads!, thread({ threadId: "other-one", machine: base.threads![0]!.machine })], selected: undefined };
};
const workflow = { mode: "workflow" };
const merge = { mode: "merge" };
const HELD: PressInput = { heldMs: 600, confirmBy: "settings" };

describe("Stop", () => {
	faces("stop", stopKey, [...connection, ["idle", STATES.idle], ["running", STATES.running], ["pinned", pinned, PIN], ["pinned-gone", pinned, GONE]]);
	faces("stop-workflow", stopKey, [
		["not-claude", STATES.idle, workflow],
		["idle", () => claude(), workflow],
		["running", () => claude(RUNNING), workflow],
		["subagents", () => claude({ subagents: 2 }), workflow],
		["subagent", () => claude({ subagents: 1 }), workflow],
		["no-thread", STATES["no-thread"], workflow],
		["read-only", () => scene({ model: { instanceId: "claudeAgent", model: "opus" }, ...RUNNING }, { canOperate: false }), workflow],
		["pinned", pinned, { ...PIN, ...workflow }],
	]);

	it("stops the running turn on a tap, as recorded", async () => {
		const running = await pressed(stopKey, scene({ ...RUNNING }));
		expect(running.machine!.stopRun).toHaveBeenCalledExactlyOnceWith(running.thread);
		expect((await pressed(stopKey, STATES.idle())).result).toEqual({ kind: "fail", label: t("reason.notRunning") });
		expect((await pressed(stopKey, STATES["no-thread"]())).result).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect((await pressed(stopKey, scene({ ...RUNNING }, { canOperate: false }))).result).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});

	it("stops every workflow only on a hold, as recorded", async () => {
		const workflows = vi.fn(async () => [{ id: "wf-a" }, { id: "wf-b" }]);
		const held = await pressed(stopKey, claude(RUNNING), workflow, HELD);
		expect((await pressed(stopKey, claude(RUNNING), workflow)).result).toEqual({ kind: "needsHold", label: t("workflow.holdToStop") });
		const world = scene({ model: { instanceId: "claudeAgent", model: "opus" }, ...RUNNING }, { workflows });
		const stopped = await pressed(stopKey, world, workflow, HELD);
		expect(stopped.machine!.stopWorkflow).toHaveBeenNthCalledWith(1, stopped.thread, "wf-a");
		expect(stopped.machine!.stopWorkflow).toHaveBeenNthCalledWith(2, stopped.thread, "wf-b");
		const none = plan(stopKey, context(claude(RUNNING), workflow), HELD);
		await expect(none.kind === "run" && none.work()).rejects.toThrow("No workflow is running.");
		expect(held.machine!.stopWorkflow).not.toHaveBeenCalled();
		expect((await pressed(stopKey, scene({ ...RUNNING }), workflow, HELD)).result).toEqual({ kind: "fail", label: t("workflow.notClaude") });
	});

	it("needs a keypad hold to stop a workflow, and takes a Ring click", async () => {
		expect((await pressed(stopKey, claude(RUNNING), workflow, { heldMs: 0, confirmBy: "hold" })).result.kind).toBe("needsHold");
		expect((await pressed(stopKey, claude(RUNNING), workflow, { heldMs: 600, confirmBy: "hold" })).result.kind).toBe("run");
		expect((await pressed(stopKey, claude(RUNNING), workflow, { heldMs: 0, confirmBy: "click" })).result.kind).toBe("run");
	});

	describe("as Logitech's Stop run", () => {
		const fallback = { fallback: "newestRunning" };
		const world = (): GoldenOptions => {
			const base = scene({ threadId: "idle", title: "Idle" });
			const owner = base.threads![0]!.machine;
			const newest = thread({ threadId: "newest", title: "Newest", machine: owner, ...RUNNING });
			const older = thread({ threadId: "older", title: "Older", machine: owner, ...RUNNING });
			return { threads: [base.threads![0]!, newest, older], selected: base.threads![0] };
		};

		it("stops the open thread when it runs, else the newest running one, on a single tap", async () => {
			const scenery = world();
			const ctx = context(scenery, fallback);
			const result = stopKey.press(stopKey.state(ctx), ctx, { heldMs: 0, confirmBy: "hold" });
			expect(result.kind).toBe("run");
			if (result.kind === "run") await result.work();
			expect(scenery.threads![0]!.machine.stopRun).toHaveBeenCalledExactlyOnceWith(scenery.threads![1]);
			const open = { ...scenery, selected: scenery.threads![2] };
			expect(stopKey.label!(stopKey.state(context(open, fallback)), context(open, fallback))).toBe("Older");
		});

		it("draws today's Ring face and names the run even where it can't stop it", () => {
			const ctx = context(world(), fallback);
			expect(stopKey.glyph!(stopKey.state(ctx), ctx)).toBe(stopFace(true));
			const readOnly = scene({ title: "Busy", ...RUNNING }, { canOperate: false });
			const blocked = context(readOnly, fallback);
			expect(stopKey.glyph!(stopKey.state(blocked), blocked)).toBe(stopFace(false));
			expect(stopKey.label!(stopKey.state(blocked), blocked)).toBe("Busy");
			expect(stopKey.press(stopKey.state(blocked), blocked, { heldMs: 0, confirmBy: "click" }).kind).toBe("fail");
			const quiet = context(STATES.idle(), fallback);
			expect(stopKey.glyph!(stopKey.state(quiet), quiet)).toBe(stopFace(false));
			expect(stopKey.label!(stopKey.state(quiet), quiet)).toBeUndefined();
		});
	});
});

const fork = (overrides: Partial<DeckThread> = {}, extra: Parameters<typeof scene>[1] = {}) => scene({ mergeInto: "parent", ...overrides }, { threadRow: () => ({ title: "Parent thread" }), ...extra });

describe("Fork", () => {
	faces("fork", forkKey, [
		...connection,
		["idle", STATES.idle],
		["running", STATES.running],
		["no-turn", () => scene({ latestRunId: null })],
		["pinned", () => ({ ...pinned(), selected: undefined }), PIN],
		["pinned-gone", pinned, GONE],
	]);
	faces("merge", forkKey, [
		["not-a-fork", STATES.idle, merge],
		["fork", () => fork(), merge],
		["fork-parent-gone", () => scene({ mergeInto: "parent" }), merge],
		["no-turn", () => fork({ latestRunId: null }), merge],
		["running", () => fork(RUNNING), merge],
		["no-thread", STATES["no-thread"], merge],
		["read-only", () => fork({}, { canOperate: false }), merge],
	]);

	it("forks on a tap and opens the fork, as recorded", async () => {
		const forked = await pressed(forkKey, scene({ threadId: "fork-src" }));
		expect(forked.machine!.fork).toHaveBeenCalledExactlyOnceWith(forked.thread);
		expect(forked.runtime.selectThread).toHaveBeenCalledExactlyOnceWith({ key: "env/fork-1", machine: forked.machine });
		expect(forked.runtime.openExternal).toHaveBeenCalledExactlyOnceWith("t3code://threads/env/fork-1");
		expect((await pressed(forkKey, scene({ latestRunId: null }))).result).toEqual({ kind: "fail", label: t("lineage.nothingToFork") });
		expect((await pressed(forkKey, STATES["read-only"]())).result).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});

	it("merges only on a hold and opens the parent, as recorded", async () => {
		expect((await pressed(forkKey, fork(), merge)).result).toEqual({ kind: "needsHold", label: t("lineage.holdToMerge") });
		const merged = await pressed(forkKey, fork({ threadId: "merge-1" }), merge, HELD);
		expect(merged.machine!.mergeBack).toHaveBeenCalledExactlyOnceWith(merged.thread, "parent");
		expect(merged.runtime.openExternal).toHaveBeenCalledExactlyOnceWith("t3code://threads/env/parent");
		expect((await pressed(forkKey, fork(RUNNING), merge, HELD)).result).toEqual({ kind: "fail", label: t("lineage.finishTurn") });
		expect((await pressed(forkKey, STATES.idle(), merge, HELD)).result).toEqual({ kind: "fail", label: t("lineage.notFork") });
		expect((await pressed(forkKey, fork(), merge, { heldMs: 0, confirmBy: "hold" })).result.kind).toBe("needsHold");
		expect((await pressed(forkKey, fork(), merge, { heldMs: 0, confirmBy: "click" })).result.kind).toBe("run");
	});
});

const status = (overrides: Record<string, unknown> = {}) =>
	({
		isRepo: true,
		hasPrimaryRemote: true,
		isDefaultRef: false,
		refName: "feat/x",
		hasWorkingTreeChanges: true,
		workingTree: { files: [{}, {}], insertions: 4, deletions: 1 },
		hasUpstream: true,
		aheadCount: 1,
		behindCount: 0,
		pr: null,
		...overrides,
	}) as unknown as VcsStatus;

describe("Branch", () => {
	const branchFace = (make: () => GoldenOptions, gitStatus?: VcsStatus) => face(branchKey, context(make(), {}, gitStatus));
	it.each([
		["no-thread", STATES["no-thread"]],
		["no-branch", STATES.idle],
		["branch", () => scene({ branch: "feat/x" })],
		["worktree", () => scene({ branch: "feat/x", worktreePath: "/work/tree" })],
	] as const)("branch-%s", (name, make) => expect(branchFace(make)).toBe(golden(`branch-${name}`)));

	it("shows the checkout's status as the git keys read it", () => {
		const feature = () => scene({ branch: "feat/x" });
		expect(branchFace(feature, status())).toBe(golden("branch-status"));
		expect(branchFace(feature, status({ hasWorkingTreeChanges: false, workingTree: { files: [] }, aheadCount: 0 }))).toBe(golden("branch-status-clean"));
		expect(branchFace(feature, status({ behindCount: 3, aheadCount: 0 }))).toBe(golden("branch-status-behind"));
	});

	it("opens the thread on a tap, as recorded", async () => {
		const opened = await pressed(branchKey, scene({ branch: "feat/x" }));
		expect(opened.runtime.openThread).toHaveBeenCalledExactlyOnceWith(opened.thread);
		expect((await pressed(branchKey, STATES.idle())).result).toEqual({ kind: "fail", label: t("reason.noBranch") });
		expect((await pressed(branchKey, STATES["no-thread"]())).result).toEqual({ kind: "fail", label: t("reason.noThread") });
	});
});
