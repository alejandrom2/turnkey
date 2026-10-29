import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { machine, RUNNING, scene, STATES, thread, uniqueUrl } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import type { MotionMode } from "../motion.js";
import type { Machine } from "../t3/machine.js";
import type { KeyContext, KeyDefinition, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { activityKey, newThreadKey, threadKey } from "./threads.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

// The clock the Stream Deck goldens were recorded at.
beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

function context<S>(world: GoldenOptions, settings: S, extra: Partial<KeyContext<S>> = {}, motion: MotionMode = "off") {
	const threads = world.threads ?? [];
	const machines: Machine[] = world.machines ?? [...new Set(threads.map((each) => each.machine))];
	const openThread = vi.fn(async (_thread: DeckThread) => undefined);
	const selectThread = vi.fn();
	const openExternal = vi.fn(async (_url: string) => undefined);
	const runtime = {
		board: { threadsOn: () => threads, selectedOn: () => world.selected },
		machines: () => machines,
		motion: () => motion,
		transitions: { age: () => undefined },
		queued: () => 0,
		scheme: () => "t3",
		openThread,
		selectThread,
		openExternal,
	} as unknown as KeyRuntime;
	const ctx: KeyContext<S> = { settings, machine: undefined, runtime, target: () => ({ thread: world.selected, pinned: false }), ...extra };
	return { ctx, openThread, selectThread, openExternal };
}

const face = <S, St>(key: KeyDefinition<S, St>, ctx: KeyContext<S>): string => decoded(key.tile(key.state(ctx), ctx));
const tap: PressInput = { heldMs: 0, confirmBy: "settings" };
const plan = <S, St>(key: KeyDefinition<S, St>, ctx: KeyContext<S>, input: PressInput = tap): PressPlan => key.press(key.state(ctx), ctx, input);
const run = async (result: PressPlan) => {
	if (result.kind !== "run") throw new Error(`expected run, got ${result.kind}`);
	await result.work();
};

describe("Thread faces match the recorded goldens", () => {
	const idle = () => scene();
	const cases: [string, () => GoldenOptions, { slot?: string }, MotionMode?][] = [
		["thread-empty", STATES["no-thread"], {}],
		["thread-idle", idle, {}],
		["thread-running", () => scene(RUNNING), {}],
		["thread-approval", STATES.approval, {}],
		["thread-question", STATES.question, {}],
		["thread-done-unseen", () => scene({ deck: "done", unseen: true }), {}],
		["thread-failed", () => scene({ deck: "failed" }), {}],
		["thread-worktree", () => scene({ worktreePath: "/work/tree" }), {}],
		["thread-subagents", () => scene({ ...RUNNING, subagents: 2 }), {}],
		["thread-selected-slot", idle, { slot: "selected" }],
		["thread-running-full", () => scene(RUNNING), {}, "full"],
		["thread-approval-full", STATES.approval, {}, "full"],
		["thread-running-reduced", () => scene(RUNNING), {}, "reduced"],
	];
	it.each(cases)("%s", (name, make, settings, motion) => {
		const { ctx } = context(make(), settings, { slot: settings.slot === "selected" ? "selected" : 0 }, motion);
		expect(face(threadKey, ctx)).toBe(golden(name));
	});

	it("tells the host to ask for frames only while it moves", () => {
		const running = context(scene(RUNNING), {}, { slot: 0 }, "full").ctx;
		expect(threadKey.moving!(threadKey.state(running))).toBe(true);
		const still = context(scene(RUNNING), {}, { slot: 0 }, "off").ctx;
		expect(threadKey.moving!(threadKey.state(still))).toBe(false);
		expect(threadKey.moving!(threadKey.state(context(scene(), {}, { slot: 0 }).ctx))).toBe(false);
	});
});

describe("Thread slot numbering", () => {
	const board = (): GoldenOptions => {
		const owner = machine({ url: uniqueUrl() });
		const threads = ["first", "second", "third"].map((id) => thread({ threadId: id, title: id, machine: owner }));
		return { threads, selected: threads[2] };
	};
	const titled = (settings: { slot?: number | string }, extra: Partial<KeyContext<{ slot?: number | string }>> = {}) => {
		const { ctx } = context(board(), settings, extra);
		return threadKey.state(ctx).thread?.title;
	};

	it("takes Thread n on Logitech to the nth thread, as Stream Deck's slot n shows with default settings", () => {
		expect(titled({ slot: 1 })).toBe("first");
		expect(titled({ slot: 3 })).toBe("third");
		expect(titled({ slot: 4 })).toBeUndefined();
		expect(titled({ slot: 0 })).toBe("third");
		expect(titled({ slot: "2" })).toBe("second");
	});

	it("prefers the slot the host worked out, which already counts the setting", () => {
		expect(titled({ slot: 1 }, { slot: 2 })).toBe("third");
	});

	it("labels the key with the thread's title", () => {
		const { ctx } = context(board(), { slot: 2 });
		expect(threadKey.label!(threadKey.state(ctx), ctx)).toBe("second");
	});
});

describe("Thread presses", () => {
	it("opens the thread on a tap and only selects it on a hold, as recorded", async () => {
		const world = scene({ threadId: "open-me" });
		const { ctx, openThread, selectThread } = context(world, {}, { slot: 0 });
		await run(plan(threadKey, ctx));
		expect(openThread).toHaveBeenCalledExactlyOnceWith(world.threads![0]);
		expect(selectThread).not.toHaveBeenCalled();
		await run(plan(threadKey, ctx, { heldMs: 600, confirmBy: "settings" }));
		expect(selectThread).toHaveBeenCalledExactlyOnceWith(world.threads![0]);
		expect(openThread).toHaveBeenCalledOnce();
	});

	it("flashes why when the slot holds no thread", () => {
		expect(plan(threadKey, context(STATES["no-thread"](), {}, { slot: 0 }).ctx)).toEqual({ kind: "fail", label: t("reason.noThread") });
	});
});

describe("Activity matches the recorded goldens", () => {
	const cases: [string, () => GoldenOptions, object][] = [
		["activity-quiet", STATES["no-thread"], {}],
		["activity-idle", STATES.idle, {}],
		["activity-running", STATES.running, {}],
		["activity-approval", STATES.approval, {}],
		["activity-question", STATES.question, {}],
		["activity-filter-attention", () => scene(), { filter: "attention" }],
		["activity-filter-active", () => scene(RUNNING), { filter: "active" }],
		["activity-filter-unread", () => scene({ deck: "done", unseen: true }), { filter: "unread" }],
		["activity-project-other", () => scene(), { project: "elsewhere" }],
	];
	it.each(cases)("%s", (name, make, settings) => {
		expect(face(activityKey, context(make(), settings, { slot: 0 }).ctx)).toBe(golden(name));
	});

	it("fills the first matching thread when the host gives no slot", () => {
		const world = scene(RUNNING);
		expect(face(activityKey, context(world, {}).ctx)).toBe(golden("activity-running"));
	});

	it("opens the thread, whatever the hold", async () => {
		const world = scene({ threadId: "open-me", ...RUNNING });
		const { ctx, openThread, selectThread } = context(world, {}, { slot: 0 });
		await run(plan(activityKey, ctx, { heldMs: 600, confirmBy: "settings" }));
		expect(openThread).toHaveBeenCalledExactlyOnceWith(world.threads![0]);
		expect(selectThread).not.toHaveBeenCalled();
		expect(plan(activityKey, context(STATES["no-thread"](), {}, { slot: 0 }).ctx)).toEqual({ kind: "fail", label: t("reason.noThread") });
	});
});

describe("New Thread", () => {
	const withProject = (overrides: Parameters<typeof machine>[0] = {}) => ({ projects: [{ id: "project", title: "Project" }, { id: "other", title: "Other" }], ...overrides });

	describe("faces match the recorded goldens", () => {
		const cases: [string, () => GoldenOptions, object][] = [
			["new-empty", () => ({ machines: [machine({ url: uniqueUrl() })] }), {}],
			["new-near", STATES.idle, {}],
			["new-read-only", STATES["read-only"], {}],
			["new-titled", STATES.idle, { title: "Scratchpad" }],
			["new-scratch", STATES.idle, { destination: "scratch" }],
			["new-project-unset", STATES.idle, { destination: "project" }],
			["new-project-missing", STATES.idle, { destination: "project", project: "nowhere" }],
			["new-project", () => scene({}, withProject()), { destination: "project", project: "other" }],
			["new-worktree", () => scene({}, withProject()), { startIn: "worktree", prompt: "Build it" }],
			["new-worktree-no-prompt", () => scene({}, withProject()), { startIn: "worktree" }],
			["new-worktree-scratch", STATES.idle, { startIn: "worktree", destination: "scratch", prompt: "Build it" }],
		];
		it.each(cases)("%s", (name, make, settings) => {
			expect(face(newThreadKey, context(make(), settings).ctx)).toBe(golden(name));
		});
	});

	describe("presses do what was recorded", () => {
		const fallbackModel = { instanceId: "codex", model: "gpt-5" };
		const pressed = async (world: GoldenOptions, settings: object) => {
			const made = context(world, settings);
			await run(plan(newThreadKey, made.ctx));
			return { ...made, target: world.threads![0]!.machine };
		};

		it("starts empty in the selected thread's project and opens it in T3 Code", async () => {
			const { target, openExternal, selectThread } = await pressed(scene({}, withProject()), {});
			expect(target.launch).toHaveBeenCalledExactlyOnceWith({ projectId: "project" }, "", { title: undefined, fallbackModel, workspaceStrategy: undefined });
			expect(openExternal).toHaveBeenCalledExactlyOnceWith("t3://threads/env/new-thread");
			expect(selectThread).toHaveBeenCalledExactlyOnceWith({ key: "env/new-thread", machine: target });
		});

		it("sends a prompt and a title without opening the app", async () => {
			const { target, openExternal, selectThread } = await pressed(scene({}, withProject()), { prompt: "Build it", title: "Build" });
			expect(target.launch).toHaveBeenCalledExactlyOnceWith({ projectId: "project" }, "Build it", { title: "Build", fallbackModel, workspaceStrategy: undefined });
			expect(openExternal).not.toHaveBeenCalled();
			expect(selectThread).toHaveBeenCalledOnce();
		});

		it("starts in the scratch project when nothing is near", async () => {
			const only = machine({ url: uniqueUrl() });
			const made = context({ machines: [only] }, { prompt: "Build it" });
			await run(plan(newThreadKey, made.ctx));
			expect(only.launch).toHaveBeenCalledExactlyOnceWith({ scratch: true }, "Build it", { title: undefined, fallbackModel: undefined, workspaceStrategy: undefined });
		});

		it("asks for the worktree strategy of the project", async () => {
			const { target } = await pressed(scene({}, withProject()), { startIn: "worktree", prompt: "Build it" });
			expect(target.worktreeStrategy).toHaveBeenCalledExactlyOnceWith("project");
			expect(target.launch).toHaveBeenCalledExactlyOnceWith({ projectId: "project" }, "Build it", { title: undefined, fallbackModel, workspaceStrategy: { type: "new_worktree" } });
		});

		it("flashes why it can't", () => {
			expect(plan(newThreadKey, context(STATES["read-only"](), { prompt: "Build it" }).ctx)).toEqual({ kind: "fail", label: t("reason.readOnly") });
			expect(plan(newThreadKey, context(scene({}, withProject()), { startIn: "worktree" }).ctx)).toEqual({ kind: "fail", label: t("worktree.needsPrompt") });
		});
	});

	it("follows only the machine the key is pinned to", () => {
		const a = machine({ url: "http://a:1", projects: [{ id: "p", title: "P" }] });
		const b = machine({ url: "http://b:1", projects: [{ id: "p", title: "P" }] });
		const state = newThreadKey.state(context({ machines: [a, b] }, { destination: "project", project: "p" }, { machine: "http://b:1" }).ctx);
		expect(state.plan.target).toBe(b);
	});
});
