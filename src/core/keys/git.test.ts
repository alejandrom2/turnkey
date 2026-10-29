import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scene, STATES } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import { checkoutOf, GitStatuses } from "../git.js";
import { t } from "../i18n.js";
import { gitKey, type GitSettings } from "./git.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => {
	vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z"));
	vi.spyOn(crypto, "randomUUID").mockReturnValue("00000000-0000-4000-8000-000000000000");
});
afterEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
});

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
const PROGRESS = [{ kind: "action_started" }, { kind: "phase_started", label: "Committing" }];
const finished = (action: string) => ({ kind: "action_finished", result: { action, pr: { status: "skipped_not_requested" }, toast: { title: "Done" } } });

const repo = (reported: Record<string, unknown> = status(), machine: Parameters<typeof scene>[1] = {}): GoldenOptions =>
	scene({ threadId: "git-1", branch: "feat/x" }, { rpc: { "vcs.refreshStatus": reported, "vcs.pull": { status: "pulled", refName: "feat/x" } }, streams: { "git.runStackedAction": [...PROGRESS, finished("commit")] }, ...machine });

/** A context over `world`, its checkout's status read as a shown key reads it first. */
async function context(world: GoldenOptions, settings: GitSettings, instance = "key-1"): Promise<KeyContext<GitSettings>> {
	const threads = world.threads ?? [];
	const repaint = vi.fn();
	const runtime = {
		board: { threads, selectedOn: () => world.selected },
		machines: () => world.machines ?? [],
		repaint,
		git: new GitStatuses(repaint),
	} as unknown as KeyRuntime;
	if (world.selected !== undefined) await runtime.git.refresh(checkoutOf(world.selected)).catch(() => undefined);
	return { settings, machine: undefined, runtime, target: () => ({ thread: world.selected, pinned: false }), instance };
}

const face = (ctx: KeyContext<GitSettings>) => decoded(gitKey.tile(gitKey.state(ctx), ctx));
const plan = (ctx: KeyContext<GitSettings>, input: PressInput): PressPlan => gitKey.press(gitKey.state(ctx), ctx, input);
const tap: PressInput = { heldMs: 0, confirmBy: "settings" };

describe("Git faces match the recorded goldens", () => {
	const cases: [string, () => GoldenOptions, GitSettings][] = [
		["git-no-thread", STATES["no-thread"], { gitAction: "commit" }],
		["git-read-only", () => scene({ branch: "feat/x" }, { canOperate: false }), {}],
		["git-no-access", () => repo(status(), { scopes: ["orchestration:read", "orchestration:operate"] }), {}],
		["git-not-a-repo", () => repo(status({ isRepo: false })), {}],
		["git-commit", () => repo(), { gitAction: "commit" }],
		["git-titled", () => repo(), { gitAction: "commit", title: "Save" }],
		["git-push-default-branch", () => repo(status({ ...CLEAN, isDefaultRef: true, refName: "main" })), { gitAction: "push" }],
		["git-pull-up-to-date", () => repo(status(CLEAN)), { gitAction: "pull" }],
	];
	it.each(cases)("%s", async (name, make, settings) => expect(face(await context(make(), settings))).toBe(golden(name)));
});

describe("Git presses", () => {
	it("on Stream Deck, refuses a push tapped by default in the words the key flashed, after reading the checkout again", async () => {
		const world = repo(status(CLEAN));
		const result = plan(await context(world, { gitAction: "push" }), tap);
		if (result.kind !== "run") throw new Error(`expected a run, got ${result.kind}`);
		await expect(result.work()).rejects.toMatchObject({ reason: t("repo.holdTo") });
		expect(world.selected!.machine.stream).not.toHaveBeenCalled();
	});

	it("on Stream Deck, commits on a tap with the key's message, showing progress on that key alone", async () => {
		const world = repo();
		const ctx = await context(world, { gitAction: "commit", commitMessage: "wip" });
		const faces: string[] = [];
		vi.mocked(ctx.runtime.repaint).mockImplementation(() => void faces.push(face(ctx)));
		const result = plan(ctx, tap);
		if (result.kind !== "run") throw new Error(`expected a run, got ${result.kind}`);
		await result.work();
		expect(world.selected!.machine.stream).toHaveBeenCalledWith(
			"git.runStackedAction",
			{ actionId: "00000000-0000-4000-8000-000000000000", cwd: "/work/project", action: "commit", commitMessage: "wip", threadId: "git-1" },
			expect.any(Function),
			"source-control:write",
		);
		expect(faces.some((each) => each.includes(t("repo.starting")))).toBe(true);
		expect(faces.some((each) => each.includes("Committing"))).toBe(true);
		expect(face(await context(world, { gitAction: "commit" }, "key-2"))).not.toContain("Committing");
	});

	it("says it's already running when pressed mid-action", async () => {
		const world = repo();
		const ctx = await context(world, { gitAction: "commit" });
		let midway: PressPlan | undefined;
		vi.mocked(ctx.runtime.repaint).mockImplementation(() => void (midway ??= face(ctx).includes(t("repo.starting")) ? plan(ctx, tap) : undefined));
		const result = plan(ctx, tap);
		if (result.kind !== "run") throw new Error(`expected a run, got ${result.kind}`);
		await result.work();
		expect(midway).toEqual({ kind: "fail", label: t("repo.running") });
	});

	it("on Logitech, needs a keypad hold for every git action, Pull and a plain Commit too, and acts on a Ring click", async () => {
		const ready = { commit: status(), push: status(CLEAN), create_pr: status(CLEAN), pull: status({ ...CLEAN, behindCount: 2, aheadCount: 0 }) };
		for (const [gitAction, reported] of Object.entries(ready)) {
			const ctx = await context(repo(reported), { gitAction });
			expect(plan(ctx, { heldMs: 599, confirmBy: "hold" })).toEqual({ kind: "needsHold", label: t("repo.holdTo") });
			expect(plan(ctx, { heldMs: 600, confirmBy: "hold" }).kind).toBe("run");
			expect(plan(ctx, { heldMs: 0, confirmBy: "click" }).kind).toBe("run");
		}
	});

	it("on Logitech, commits with T3 Code's own message and pushes without the default-branch hold Stream Deck asks", async () => {
		const world = repo();
		const commit = plan(await context(world, { gitAction: "commit" }), { heldMs: 0, confirmBy: "click" });
		if (commit.kind !== "run") throw new Error(`expected a run, got ${commit.kind}`);
		await commit.work();
		expect(vi.mocked(world.selected!.machine.stream).mock.calls[0]![1]).toEqual({ actionId: "00000000-0000-4000-8000-000000000000", cwd: "/work/project", action: "commit", commitMessage: undefined, threadId: "git-1" });

		const main = repo(status({ ...CLEAN, isDefaultRef: true, refName: "main" }));
		const push = plan(await context(main, { gitAction: "push" }), { heldMs: 600, confirmBy: "hold" });
		if (push.kind !== "run") throw new Error(`expected a run, got ${push.kind}`);
		await push.work();
		expect(main.selected!.machine.stream).toHaveBeenCalledOnce();
	});

	it("flashes why the checkout can't take it, read fresh on the press", async () => {
		const result = plan(await context(repo(status(CLEAN)), { gitAction: "commit" }), { heldMs: 0, confirmBy: "click" });
		expect(result).toEqual({ kind: "fail", label: t("repo.reason.clean") });
	});
});
