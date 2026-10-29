import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { scene, STATES } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { type PrKeySettings, pullRequestKey } from "./pr.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

const link = (overrides: Partial<DeckThread["pullRequests"][number]> = {}): DeckThread["pullRequests"][number] => ({
	url: "https://github.com/acme/app/pull/7",
	number: 7,
	repository: "acme/app",
	state: "open",
	title: "Fix the build",
	headBranch: "feat/x",
	...overrides,
});
const reviewThread = { id: "thread-a", path: "src/app.ts", line: 4, side: "right" as const, isResolved: false, comments: [{ id: "c1", author: { login: "r" }, body: "Handle null." }] };
const quiet = { comments: [], reviewThreads: [], commentsTruncated: false };

/** A selected thread linking a pull request; `activity` is what its findings read. Each gets its own machine, as the store keys by it. */
const withPr = (links = [link()], activity: unknown = quiet, machine: Parameters<typeof scene>[1] = {}): GoldenOptions =>
	scene({ branch: "feat/x", pullRequests: links }, { url: `http://pr-${Math.random()}:3773`, rpc: { "pullRequests.summary": { number: 7, title: "Fix the build", url: link().url, state: "open" }, "pullRequests.checks": { checks: [] }, "pullRequests.activity": activity }, ...machine });

function context(world: GoldenOptions, settings: PrKeySettings): KeyContext<PrKeySettings> {
	const runtime = {
		board: { threads: world.threads ?? [], selectedOn: () => world.selected },
		repaint: vi.fn(),
		openUrl: vi.fn(async () => undefined),
		openThread: vi.fn(async () => undefined),
	} as unknown as KeyRuntime;
	return { settings, machine: undefined, runtime, target: () => ({ thread: world.selected, pinned: false }) };
}

const face = (ctx: KeyContext<PrKeySettings>) => decoded(pullRequestKey.tile(pullRequestKey.state(ctx), ctx));
const plan = (ctx: KeyContext<PrKeySettings>, input: PressInput): PressPlan => pullRequestKey.press(pullRequestKey.state(ctx), ctx, input);
const tap: PressInput = { heldMs: 0, confirmBy: "settings" };

describe("Pull Request faces match the recorded goldens", () => {
	const cases: [string, () => GoldenOptions, PrKeySettings][] = [
		["pr-no-thread", STATES["no-thread"], {}],
		["pr-no-pr", STATES.idle, {}],
		["pr-merged", () => withPr([link({ state: "merged" })]), {}],
		["pr-explain-open", () => withPr(), { mode: "explain" }],
		["pr-explain-gitlab", () => withPr([link({ url: "https://gitlab.com/acme/app/-/merge_requests/7" })]), { mode: "explain" }],
		["pr-ask-open", () => withPr(), { mode: "ask" }],
		["pr-fix-no-pr", STATES.idle, { mode: "fix" }],
		["pr-fix-read-only", () => withPr([link()], quiet, { canOperate: false }), { mode: "fix" }],
	];
	it.each(cases)("%s", (name, make, settings) => expect(face(context(make(), settings))).toBe(golden(name)));

	it("pr-fix-threads, once the findings are read", async () => {
		const ctx = context(withPr([link()], { ...quiet, reviewThreads: [reviewThread] }), { mode: "fix" });
		face(ctx);
		await vi.advanceTimersByTimeAsync(0);
		expect(face(ctx)).toBe(golden("pr-fix-threads"));
	});
});

describe("Pull Request presses", () => {
	it("opens a pull request's web page, and only a web page", async () => {
		const ctx = context(withPr(), {});
		const result = plan(ctx, { heldMs: 0, confirmBy: "click" });
		if (result.kind !== "run") throw new Error(`expected a run, got ${result.kind}`);
		await result.work();
		expect(ctx.runtime.openUrl).toHaveBeenCalledExactlyOnceWith("https://github.com/acme/app/pull/7");
		expect(plan(context(withPr([link({ url: "http://example.test/pr/7" })]), {}), tap)).toEqual({ kind: "fail", label: t("result.notWebLink") });
		expect(plan(context(STATES.idle(), {}), tap)).toEqual({ kind: "fail", label: t("reason.noPr") });
	});

	it("on Stream Deck, holds Fix findings back from a tap unless its To send setting says tap", async () => {
		const world = withPr([link()], { ...quiet, reviewThreads: [reviewThread] });
		face(context(world, { mode: "fix" }));
		await vi.advanceTimersByTimeAsync(0);
		expect(plan(context(world, { mode: "fix" }), tap)).toEqual({ kind: "needsHold", label: t("repo.holdTo") });
		expect(plan(context(world, { mode: "fix" }), { heldMs: 600, confirmBy: "settings" }).kind).toBe("run");
		expect(plan(context(world, { mode: "fix", confirm: "tap" }), tap).kind).toBe("run");
	});

	it("on Logitech, holds Fix findings for a keypad hold, and sends the rest on a tap", async () => {
		const world = withPr([link()], { ...quiet, reviewThreads: [reviewThread] });
		face(context(world, { mode: "fix" }));
		await vi.advanceTimersByTimeAsync(0);
		expect(plan(context(world, { mode: "fix" }), { heldMs: 599, confirmBy: "hold" })).toEqual({ kind: "needsHold", label: t("repo.holdTo") });
		expect(plan(context(world, { mode: "fix" }), { heldMs: 600, confirmBy: "hold" }).kind).toBe("run");
		expect(plan(context(world, { mode: "fix" }), { heldMs: 0, confirmBy: "click" }).kind).toBe("run");
		for (const mode of ["explain", "ask", "guide"]) expect(plan(context(withPr(), { mode }), { heldMs: 0, confirmBy: "hold" }).kind).toBe("run");
	});

	it("asks by opening the thread that holds the pull request", async () => {
		const world = withPr();
		const ctx = context(world, { mode: "ask" });
		const result = plan(ctx, { heldMs: 0, confirmBy: "hold" });
		if (result.kind !== "run") throw new Error(`expected a run, got ${result.kind}`);
		await result.work();
		expect(ctx.runtime.openThread).toHaveBeenCalledExactlyOnceWith(world.selected);
	});
});
