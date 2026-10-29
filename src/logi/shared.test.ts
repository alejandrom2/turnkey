import { afterEach, describe, expect, it, vi } from "vitest";

import { machine, modelConfig, RUNNING, thread } from "../actions/testing/fixtures.js";
import type { DeckThread, ThreadBoard } from "../core/board.js";
import { FLASH_MS } from "../core/feedback.js";
import { t } from "../core/i18n.js";
import { approveKey, denyKey } from "../core/keys/decision.js";
import { gitKey } from "../core/keys/git.js";
import { healthKey } from "../core/keys/health.js";
import { openKey } from "../core/keys/open.js";
import { shareKey } from "../core/keys/share.js";
import { createUpdateKey } from "../core/keys/update.js";
import { usageKey } from "../core/keys/usage.js";
import { branchKey, forkKey, stopKey } from "../core/keys/lineage.js";
import { ORGANIZE_ACTIONS, organizeKey } from "../core/keys/organize.js";
import { planKey, speedKey } from "../core/keys/power.js";
import { pullRequestKey } from "../core/keys/pr.js";
import { activityKey, newThreadKey, threadKey } from "../core/keys/threads.js";
import type { KeyDefinition } from "../core/keys/key.js";
import { needsAccessLabel } from "../core/scopes.js";
import { COLORS, glyph, renderResultKey, renderSkeletonKey, svgImage, svgMarkup } from "../core/render.js";
import type { Decision, PendingRequest } from "../core/t3/machine.js";
import { Keys } from "./keys.js";
import type { SidecarMessage } from "./protocol.js";
import { glyphResult, ringFace } from "./ring.js";
import { logiRuntime } from "./runtime.js";
import { glyphFallback, sharedKind } from "./shared.js";

const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

const ALL: Decision[] = ["accept", "acceptForSession", "acceptAlways", "decline"];
let ids = 0;
/** A thread waiting on an approval; each gets its own id, since keys share their loaded requests. */
function waiting(request?: PendingRequest): DeckThread {
	const id = `t${++ids}`;
	const answer = request ?? { type: "approval", threadId: id, requestId: "req", heading: "Run a command", summary: "npm run build", decisions: ALL };
	return thread({ threadId: id, key: `env/${id}`, deck: "approval", pendingRequest: { id: "req", kind: "command", createdAt: "", threadId: id }, machine: machine({ request: answer }) });
}

/** The sidecar's runtime over a board whose selection is `selected.current`. */
function setup(selected: { current: DeckThread | undefined }) {
	const repaint = vi.fn();
	const openThread = vi.fn(async (_thread: DeckThread) => undefined);
	const board = {
		get threads() {
			return selected.current ? [selected.current] : [];
		},
		threadsOn: () => (selected.current ? [selected.current] : []),
		selectedOn: () => selected.current,
	} as unknown as ThreadBoard;
	const warn = vi.fn<(message: string) => void>();
	const runtime = logiRuntime({ machines: () => [machine()], board, openThread, selectThread: () => undefined, repaint, warn });
	return { runtime, repaint, openThread, warn };
}

/** The request loads asynchronously: the first face starts it, and the runtime repaints when it lands. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => void vi.useRealTimers());

describe("sharedKind faces", () => {
	const still: KeyDefinition<object, string> = {
		state: (ctx) => ctx.runtime.motion(),
		tile: (motion) => svgImage(144, 144, `<rect class="tile ${motion}"/>`),
		glyph: (motion) => svgImage(144, 144, `<circle class="glyph ${motion}"/>`),
		press: () => ({ kind: "nothing" }),
	};

	it("draws the glyph at 80 px or less and the tile above, as markup, with Motion off: Logitech draws no frames", () => {
		const kind = sharedKind("still", still, { "": {} }, setup({ current: undefined }).runtime);
		expect(kind.face(0, "", 80)).toBe(svgMarkup(144, 144, `<circle class="glyph off"/>`));
		expect(kind.face(0, "", 60)).toBe(svgMarkup(144, 144, `<circle class="glyph off"/>`));
		expect(kind.face(0, "", 116)).toBe(svgMarkup(144, 144, `<rect class="tile off"/>`));
		expect(kind.face(0, "", 144)).toBe(svgMarkup(144, 144, `<rect class="tile off"/>`));
	});

	it("builds a ring glyph from the tile's icon when a key has no glyph, dimmed as the tile dims it", async () => {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime } = setup(selected);
		const approve = sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, runtime);
		const deny = sharedKind("deny", denyKey, { "": {} }, runtime);
		// While the request loads the tile is a skeleton, with no icon: a dim placeholder glyph stands in, never the tile.
		expect(approve.face(0, "", 80)).toBe(ringFace(COLORS.muted, "chat", { dim: true }));
		expect(approve.face(0, "", 116)).toBe(decoded(renderSkeletonKey()));
		await settle();
		expect(approve.face(0, "", 80)).toBe(ringFace(COLORS.accent, "check"));
		expect(deny.face(0, "", 80)).toBe(ringFace(COLORS.accent, "denyCircle"));
		// A keypad holds to deny, so its tile says so before a tap is refused.
		await expect(deny.face(0, "", 116)).toMatchFileSnapshot("./__goldens__/sharedDeny-hold-116.svg");
		selected.current = undefined;
		expect(approve.face(0, "", 80)).toBe(ringFace(COLORS.accent, "check", { dim: true }));
		expect(deny.face(0, "", 80)).toBe(ringFace(COLORS.accent, "denyCircle", { dim: true }));
	});

	it("dims a fallback glyph by what the definition says, not by what the tile's markup looks like", () => {
		const draw = (available: boolean | undefined, tile: string) => {
			const key: KeyDefinition<object, string> = {
				state: () => "",
				tile: () => svgImage(144, 144, tile),
				available: available === undefined ? undefined : () => available,
				press: () => ({ kind: "nothing" }),
			};
			return sharedKind("probe", key, { "": {} }, setup({ current: undefined }).runtime).face(0, "", 80);
		};
		const check = `<g opacity=".5">${glyph("check", 0, 0, 24, "#fff")}</g>`;
		// Another key's tile may fade its icon for its own reasons.
		expect(draw(true, check)).toBe(ringFace(COLORS.accent, "check"));
		expect(draw(undefined, check)).toBe(ringFace(COLORS.accent, "check"));
		expect(draw(false, glyph("check", 0, 0, 24, "#fff"))).toBe(ringFace(COLORS.accent, "check", { dim: true }));
	});

	it("draws nothing for a variant it doesn't have, and says so once", () => {
		const { runtime, warn } = setup({ current: waiting() });
		const kind = sharedKind("approve", approveKey, { "": {} }, runtime);
		expect(kind.face(0, "nope", 80)).toBeUndefined();
		expect(kind.press!(0, "nope")).toBeUndefined();
		expect(kind.face(0, "other", 116)).toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
	});
});

describe("sharedKind presses", () => {
	it("refuses a Stream Deck review plan, saying so once, so nothing skips a keypad hold", async () => {
		const { runtime, repaint, warn } = setup({ current: undefined });
		const work = vi.fn(async () => undefined);
		const reviewing: KeyDefinition<object, null> = {
			state: () => null,
			tile: () => svgImage(144, 144, "<rect/>"),
			press: () => ({ kind: "guard", guard: { scope: "", holdHint: "Hold", card: () => ({ glyph: "pin", verb: "Pin", target: "", footer: "" }) }, work }),
		};
		const kind = sharedKind("reviewing", reviewing, { "": {} }, runtime);
		kind.press!(0, "", 0);
		kind.press!(0, "");
		await settle();
		expect(work).not.toHaveBeenCalled();
		expect(repaint).not.toHaveBeenCalled();
		expect(warn).toHaveBeenCalledExactlyOnceWith("reviewing: a key asked for Stream Deck's review, which Logitech doesn't have.");
	});

	async function approve(settings = { approvalAuthority: "once" }) {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime, repaint, warn } = setup(selected);
		const kind = sharedKind("approve", approveKey, { "": settings }, runtime);
		kind.face(0, "", 80);
		await settle();
		return { kind, target: selected.current!, selected, repaint, warn };
	}

	it("takes a Ring click, with no hold time, as the confirmation", async () => {
		const { kind, target, repaint } = await approve();
		kind.press!(0, "");
		await settle();
		expect(target.machine.respond).toHaveBeenCalledExactlyOnceWith(target.threadId, "req", "accept");
		expect(repaint).toHaveBeenCalled();
	});

	it("on a keypad, flashes the hold it needs after a short press, then shows the key again", async () => {
		vi.useFakeTimers();
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime, repaint } = setup(selected);
		const kind = sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, runtime);
		kind.face(0, "", 80);
		await vi.advanceTimersByTimeAsync(0);
		const live = kind.face(0, "", 80);
		kind.press!(0, "", 100);
		expect(selected.current!.machine.respond).not.toHaveBeenCalled();
		expect(kind.face(0, "", 80)).toBe(glyphResult(false, t("result.holdToAllow")));
		expect(kind.face(0, "", 116)).toBe(decoded(renderResultKey({ ok: false, label: t("result.holdToAllow") })));
		expect(kind.label!(0, "")).toBe(t("result.holdToAllow"));
		repaint.mockClear();
		vi.advanceTimersByTime(FLASH_MS);
		expect(repaint).toHaveBeenCalledOnce();
		expect(kind.face(0, "", 80)).toBe(live);
		expect(kind.label!(0, "")).toBeUndefined();
	});

	it("on a keypad, acts after a 600 ms hold", async () => {
		const { kind, target } = await approve();
		kind.press!(0, "", 600);
		expect(target.machine.respond).toHaveBeenCalledExactlyOnceWith(target.threadId, "req", "accept");
	});

	it("says Deny needs a hold in Deny's own words", async () => {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime } = setup(selected);
		const kind = sharedKind("deny", denyKey, { "": {} }, runtime);
		kind.face(0, "", 80);
		await settle();
		kind.press!(0, "", 100);
		expect(kind.label!(0, "")).toBe(t("result.holdToDeny"));
		kind.press!(0, "", 600);
		expect(selected.current!.machine.respond).toHaveBeenCalledExactlyOnceWith(selected.current!.threadId, "req", "decline");
	});

	it("flashes why when the thread is gone between paint and press", async () => {
		const { kind, target, selected } = await approve();
		selected.current = undefined;
		kind.press!(0, "");
		expect(target.machine.respond).not.toHaveBeenCalled();
		expect(kind.label!(0, "")).toBe(t("reason.nothingPending"));
		expect(kind.face(0, "", 80)).toBe(glyphResult(false, t("reason.nothingPending")));
	});

	it("clears a flash when a later press succeeds", async () => {
		const { kind, target } = await approve();
		kind.press!(0, "", 100);
		expect(kind.label!(0, "")).toBe(t("result.holdToAllow"));
		kind.press!(0, "", 600);
		await settle();
		expect(target.machine.respond).toHaveBeenCalledOnce();
		expect(kind.label!(0, "")).toBeUndefined();
		expect(kind.face(0, "", 80)).not.toBe(glyphResult(false, t("result.holdToAllow")));
	});

	it("flashes a run's notice once its work has started, and keeps it after the work succeeds", async () => {
		const { runtime } = setup({ current: undefined });
		const work = vi.fn(async () => undefined);
		const noticing: KeyDefinition<object, null> = { state: () => null, tile: () => renderSkeletonKey(), press: () => ({ kind: "run", work, notice: "Hold to use reset" }) };
		const kind = sharedKind("noticing", noticing, { "": {} }, runtime);
		kind.press!(0, "");
		expect(work).toHaveBeenCalledOnce();
		expect(kind.label!(0, "")).toBe("Hold to use reset");
		await settle();
		expect(kind.face(0, "", 80)).toBe(glyphResult(false, "Hold to use reset"));
		const quiet = sharedKind("quiet", noticing, { "": {} }, runtime, { quiet: () => undefined });
		quiet.press!(0, "");
		expect(quiet.label!(0, "")).toBeUndefined();
	});

	it("flashes and logs a press T3 Code refuses, naming the kind", async () => {
		const { kind, target, warn } = await approve();
		vi.mocked(target.machine.respond).mockRejectedValueOnce(new Error("timed out"));
		kind.press!(0, "");
		await settle();
		expect(kind.label!(0, "")).toBe(t("failure.timedOut"));
		expect(warn).toHaveBeenCalledExactlyOnceWith("approve: a press failed: timed out");
	});
});

describe("sharedKind in Keys", () => {
	it("draws the keypad's tile and flashes a short hold there, at the size the key appeared at", async () => {
		const selected = { current: waiting() as DeckThread | undefined };
		const { runtime } = setup(selected);
		const sent: SidecarMessage[] = [];
		const keys = new Keys({ approve: sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, runtime) }, (message) => sent.push(message));
		keys.handle({ type: "appear", action: "approve:", size: 116 });
		await settle();
		keys.repaint();
		keys.handle({ type: "press", action: "approve:", heldMs: 100 });
		expect(sent.at(-1)).toEqual({ type: "image", action: "approve:", size: 116, svg: decoded(renderResultKey({ ok: false, label: t("result.holdToAllow") })), label: t("result.holdToAllow") });
	});
});

describe("sharedKind over the board's threads", () => {
	/** A board of three threads on one machine, with T3 Code's selection on the first. */
	function board() {
		const owner = machine({ projects: [{ id: "project", title: "Project" }] });
		const threads = ["first", "second", "third"].map((id) => thread({ threadId: id, key: `env/${id}`, title: id, machine: owner }));
		const running = thread({ threadId: "busy", key: "env/busy", title: "busy", machine: owner, ...RUNNING });
		const repaint = vi.fn();
		const openThread = vi.fn(async (_thread: DeckThread) => undefined);
		const selectThread = vi.fn();
		const all = [running, ...threads];
		const world = { threads: all, threadsOn: () => all, selectedOn: () => threads[0] } as unknown as ThreadBoard;
		const warn = vi.fn<(message: string) => void>();
		const runtime = logiRuntime({ machines: () => [owner], board: world, openThread, selectThread, repaint, warn });
		const kind = sharedKind("thread", threadKey, Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((slot) => [String(slot), { slot }])), runtime);
		return { all, owner, runtime, repaint, openThread, selectThread, kind, warn };
	}

	it("draws Thread n from the nth thread's tile, the glyph on the Ring and the tile on a keypad", () => {
		const { kind, all } = board();
		const ctx = { settings: { slot: 1 }, machine: undefined, runtime: board().runtime, target: () => ({ thread: undefined, pinned: false }) };
		const busy = decoded(threadKey.tile(threadKey.state(ctx), ctx));
		expect(kind.face(0, "1", 116)).toBe(busy);
		expect(kind.face(0, "1", 80)).toBe(glyphFallback(busy, false));
		expect(kind.label!(0, "1")).toBe(all[0]!.title);
		expect(kind.label!(0, "3")).toBe("second");
	});

	it("draws a dim placeholder for a slot past the board, and says why on a press", () => {
		const { kind, openThread } = board();
		expect(kind.face(0, "8", 80)).toBe(ringFace(COLORS.accent, "chat", { dim: true }));
		kind.press!(0, "8");
		expect(openThread).not.toHaveBeenCalled();
		expect(kind.label!(0, "8")).toBe(t("reason.noThread"));
	});

	it("opens the thread on a click or a tap, and only selects it after a keypad hold", () => {
		const { kind, all, openThread, selectThread } = board();
		kind.press!(0, "2");
		kind.press!(0, "2", 100);
		expect(openThread.mock.calls.map(([each]) => each)).toEqual([all[1], all[1]]);
		kind.press!(0, "2", 600);
		expect(selectThread).toHaveBeenCalledExactlyOnceWith(all[1]);
		expect(openThread).toHaveBeenCalledTimes(2);
	});

	it("shows the most urgent thread as Activity and opens it", () => {
		const { runtime, all, openThread } = board();
		const kind = sharedKind("activity", activityKey, { "": {} }, runtime);
		expect(kind.label!(0, "")).toBe("busy");
		kind.press!(0, "", 600);
		expect(openThread).toHaveBeenCalledExactlyOnceWith(all[0]);
	});

	it("starts a thread in the open thread's project as New Thread, opening it in T3 Code", async () => {
		const { runtime, owner } = board();
		const open = vi.spyOn(runtime, "openExternal").mockResolvedValue(undefined);
		const select = vi.spyOn(runtime, "selectThread");
		const kind = sharedKind("newThread", newThreadKey, { "": {} }, runtime);
		kind.press!(0, "");
		await settle();
		expect(owner.launch).toHaveBeenCalledExactlyOnceWith({ projectId: "project" }, "", expect.objectContaining({ fallbackModel: { instanceId: "codex", model: "gpt-5" } }));
		expect(select).toHaveBeenCalledExactlyOnceWith({ key: "env/new-thread", machine: owner });
		expect(open).toHaveBeenCalledExactlyOnceWith("t3code://threads/env/new-thread");
	});

	it("draws the thread faces as recorded", async () => {
		const { kind } = board();
		await expect(kind.face(0, "1", 80)).toMatchFileSnapshot("./__goldens__/sharedThread-running-80.svg");
		await expect(kind.face(0, "2", 80)).toMatchFileSnapshot("./__goldens__/sharedThread-idle-80.svg");
		await expect(kind.face(0, "8", 80)).toMatchFileSnapshot("./__goldens__/sharedThread-empty-80.svg");
	});
});

describe("sharedKind for an action that shipped before shared keys", () => {
	const refusing: KeyDefinition<{ place: number }, number> = {
		state: (ctx) => ctx.settings.place,
		tile: () => svgImage(144, 144, `<rect class="tile"/>`),
		glyph: (place) => svgMarkup(144, 144, `<circle class="glyph ${place}"/>`),
		press: (place) => (place === 0 ? { kind: "fail", label: "No" } : { kind: "run", work: async () => Promise.reject(new Error("refused")) }),
	};

	it("takes its settings from the parameter, draws the tile on a keypad, and never flashes", async () => {
		const { runtime, repaint, warn } = setup({ current: undefined });
		const failed = vi.fn();
		const kind = sharedKind("legacy", refusing, (parameter) => ({ place: Number(parameter) }), runtime, { quiet: failed });
		expect(kind.face(0, "7", 116)).toBe(svgMarkup(144, 144, `<rect class="tile"/>`));
		kind.press!(0, "0");
		kind.press!(0, "7", 600);
		await settle();
		expect(failed).toHaveBeenCalledExactlyOnceWith(new Error("refused"));
		expect(kind.face(0, "0", 80)).toBe(svgMarkup(144, 144, `<circle class="glyph 0"/>`));
		expect(kind.face(0, "0", 116)).toBe(svgMarkup(144, 144, `<rect class="tile"/>`));
		expect(kind.label?.(0, "0")).toBeUndefined();
		expect(repaint).not.toHaveBeenCalled();
		expect(warn).not.toHaveBeenCalled();
	});
});

describe("sharedKind over the power keys", () => {
	function power(overrides: Partial<DeckThread> = {}, config: object = modelConfig()) {
		const selected = { current: thread({ machine: machine({ modelConfig: config }), ...overrides }) };
		const made = setup(selected);
		return { ...made, thread: selected.current, speed: sharedKind("speed", speedKey, { "": {} }, made.runtime), plan: sharedKind("plan", planKey, { "": {} }, made.runtime) };
	}
	const tile = <S, St>(key: KeyDefinition<S, St>, runtime: ReturnType<typeof setup>["runtime"]) => {
		const ctx = { settings: {} as S, machine: undefined, runtime, target: () => ({ thread: runtime.board.selectedOn(), pinned: false }) };
		return decoded(key.tile(key.state(ctx), ctx));
	};

	it("draws Speed and Plan from their tiles: the glyph on the Ring, the tile on a keypad", async () => {
		const standard = power();
		expect(standard.speed.face(0, "", 116)).toBe(tile(speedKey, standard.runtime));
		expect(standard.plan.face(0, "", 116)).toBe(tile(planKey, standard.runtime));
		await expect(standard.speed.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedSpeed-standard-80.svg");
		await expect(standard.plan.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedPlan-build-80.svg");
		await expect(power({ model: { instanceId: "codex", model: "gpt-5", options: [{ id: "serviceTier", value: "fast" }] } }).speed.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedSpeed-fast-80.svg");
		await expect(power({ interactionMode: "plan" }).plan.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedPlan-plan-80.svg");
	});

	it("toggles fast mode and Build or Plan on a click or a tap", () => {
		const { speed, plan, thread: open } = power();
		speed.press!(0, "");
		plan.press!(0, "", 100);
		expect(open!.machine.setModelSelection).toHaveBeenCalledExactlyOnceWith(open, { instanceId: "codex", model: "gpt-5", options: [{ id: "serviceTier", value: "fast" }] });
		expect(open!.machine.setInteractionMode).toHaveBeenCalledExactlyOnceWith(open, "plan");
	});

	it("says why it can't, as Stream Deck does", () => {
		const { speed, plan } = power({ model: { instanceId: "codex", model: "gpt-5-mini" } }, modelConfig({ codexPlanToggle: false }));
		expect(speed.face(0, "", 80)).toContain(`<g opacity=".6">`);
		speed.press!(0, "");
		plan.press!(0, "");
		expect(speed.label!(0, "")).toBe(t("reason.noFastMode"));
		expect(plan.label!(0, "")).toBe(t("reason.noPlanMode"));
	});
});

describe("sharedKind over the lineage and organize keys", () => {
	function lineage(overrides: Partial<DeckThread> = {}) {
		const selected = { current: thread({ title: "Open thread", machine: machine({ modelConfig: modelConfig() }), ...overrides }) };
		const made = setup(selected);
		const organize = sharedKind("organize", organizeKey, Object.fromEntries(ORGANIZE_ACTIONS.map((which) => [which, { organize: which }])), made.runtime);
		return {
			...made,
			thread: selected.current,
			stopWorkflow: sharedKind("stopWorkflow", stopKey, { "": { mode: "workflow" } }, made.runtime),
			fork: sharedKind("fork", forkKey, { "": {} }, made.runtime),
			merge: sharedKind("merge", forkKey, { "": { mode: "merge" } }, made.runtime),
			branch: sharedKind("branch", branchKey, { "": {} }, made.runtime),
			organize,
		};
	}

	it("draws their Ring glyphs", async () => {
		const keys = lineage({ model: { instanceId: "claudeAgent", model: "opus" }, mergeInto: "parent", branch: "feat/x", ...RUNNING });
		await expect(keys.stopWorkflow.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedStopWorkflow-80.svg");
		await expect(keys.fork.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedFork-80.svg");
		await expect(keys.merge.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedMerge-80.svg");
		await expect(keys.branch.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedBranch-80.svg");
		for (const which of ORGANIZE_ACTIONS) await expect(keys.organize.face(0, which, 80)).toMatchFileSnapshot(`./__goldens__/sharedOrganize-${which}-80.svg`);
		await expect(lineage({ mergeInto: "parent" }).merge.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedMerge-available-80.svg");
		expect(keys.branch.label!(0, "")).toBe("feat/x");
		expect(keys.fork.label!(0, "")).toBe("Open thread");
	});

	it("says hold on the keypad tiles of the keys a keypad holds for, and only those", async () => {
		const claude = lineage({ model: { instanceId: "claudeAgent", model: "opus" }, ...RUNNING });
		await expect(claude.stopWorkflow.face(0, "", 116)).toMatchFileSnapshot("./__goldens__/sharedStopWorkflow-hold-116.svg");
		const keys = lineage({ mergeInto: "parent" });
		await expect(keys.merge.face(0, "", 116)).toMatchFileSnapshot("./__goldens__/sharedMerge-hold-116.svg");
		await expect(keys.organize.face(0, "archive", 116)).toMatchFileSnapshot("./__goldens__/sharedOrganize-archive-hold-116.svg");
		for (const which of ORGANIZE_ACTIONS.filter((which) => which !== "archive")) expect(keys.organize.face(0, which, 116)).not.toContain(t("strip.withHold", { label: "" }));
		expect(keys.fork.face(0, "", 116)).not.toContain(t("strip.holdThen", { detail: "" }));
	});

	it("archives only after a keypad hold, or on a Ring click", async () => {
		vi.useFakeTimers();
		const { organize, thread: open } = lineage();
		organize.press!(0, "archive", 100);
		expect(organize.label!(0, "archive")).toBe(t("result.holdToArchive"));
		expect(open!.machine.archive).not.toHaveBeenCalled();
		organize.press!(0, "archive", 600);
		organize.press!(0, "archive");
		expect(open!.machine.archive).toHaveBeenCalledTimes(2);
	});

	it("settles, snoozes for Stream Deck's default hour and toggles a pin on a tap", () => {
		const { organize, thread: open } = lineage();
		organize.press!(0, "settle", 0);
		organize.press!(0, "snooze", 0);
		organize.press!(0, "pin", 0);
		expect(open!.machine.settle).toHaveBeenCalledExactlyOnceWith(open);
		expect(open!.machine.snooze).toHaveBeenCalledExactlyOnceWith(open, 60);
		expect(open!.machine.pin).toHaveBeenCalledExactlyOnceWith(open);
	});

	it("needs a keypad hold to merge or stop a workflow, and forks on a tap", async () => {
		vi.useFakeTimers();
		const keys = lineage({ mergeInto: "parent" });
		keys.merge.press!(0, "", 0);
		expect(keys.merge.label!(0, "")).toBe(t("lineage.holdToMerge"));
		keys.merge.press!(0, "", 600);
		keys.fork.press!(0, "", 0);
		expect(keys.thread!.machine.mergeBack).toHaveBeenCalledExactlyOnceWith(keys.thread, "parent");
		expect(keys.thread!.machine.fork).toHaveBeenCalledExactlyOnceWith(keys.thread);
		const claude = lineage({ model: { instanceId: "claudeAgent", model: "opus" }, ...RUNNING });
		claude.stopWorkflow.press!(0, "", 0);
		expect(claude.stopWorkflow.label!(0, "")).toBe(t("workflow.holdToStop"));
		expect(claude.thread!.machine.workflows).not.toHaveBeenCalled();
		claude.stopWorkflow.press!(0, "");
		expect(claude.thread!.machine.workflows).toHaveBeenCalledExactlyOnceWith(claude.thread);
	});
});

describe("sharedKind over the git and pull request keys", () => {
	const dirty = { isRepo: true, hasPrimaryRemote: true, isDefaultRef: false, refName: "feat/x", hasWorkingTreeChanges: true, workingTree: { files: [{}, {}], insertions: 4, deletions: 1 }, hasUpstream: true, aheadCount: 1, behindCount: 0, aheadOfDefaultCount: 1, pr: null };
	const link = { url: "https://github.com/acme/app/pull/7", number: 7, repository: "acme/app", state: "open" as const, title: "Fix the build", headBranch: "feat/x" };
	const quiet = { comments: [], reviewThreads: [], commentsTruncated: false };
	const reviewThread = { id: "thread-a", path: "src/app.ts", line: 4, side: "right" as const, isResolved: false, comments: [{ id: "c1", author: { login: "r" }, body: "Handle null." }] };

	function keys() {
		const owner = machine({
			url: "http://git-keys:3773",
			rpc: { "vcs.refreshStatus": dirty, "pullRequests.summary": { number: 7, title: "Fix the build", url: link.url, state: "open" }, "pullRequests.checks": { checks: [] }, "pullRequests.activity": { ...quiet, reviewThreads: [reviewThread] } },
			streams: { "git.runStackedAction": [{ kind: "action_started" }, { kind: "action_finished", result: { action: "commit", pr: { status: "skipped_not_requested" }, toast: { title: "Done" } } }] },
		});
		const selected = { current: thread({ title: "Open thread", branch: "feat/x", machine: owner, pullRequests: [link] }) };
		const made = setup(selected);
		return {
			...made,
			thread: selected.current,
			git: sharedKind("git", gitKey, Object.fromEntries((["commit", "push", "create_pr", "pull"] as const).map((gitAction) => [gitAction, { gitAction }])), made.runtime),
			pr: sharedKind("pr", pullRequestKey, { pr: { mode: "show" }, fix: { mode: "fix" }, explain: { mode: "explain" }, ask: { mode: "ask" }, guide: { mode: "guide" } }, made.runtime),
		};
	}

	it("draws their Ring glyphs and keypad tiles once the checkout and the pull request are read", async () => {
		const { git, pr } = keys();
		git.face(0, "commit", 80);
		pr.face(0, "pr", 80);
		await settle();
		await expect(git.face(0, "commit", 80)).toMatchFileSnapshot("./__goldens__/sharedGit-commit-80.svg");
		await expect(git.face(0, "commit", 116)).toMatchFileSnapshot("./__goldens__/sharedGit-commit-hold-116.svg");
		await expect(pr.face(0, "pr", 80)).toMatchFileSnapshot("./__goldens__/sharedPr-80.svg");
		await expect(pr.face(0, "fix", 80)).toMatchFileSnapshot("./__goldens__/sharedPr-fix-80.svg");
		await expect(pr.face(0, "fix", 116)).toMatchFileSnapshot("./__goldens__/sharedPr-fix-hold-116.svg");
		expect(pr.face(0, "explain", 116)).not.toContain(t("strip.holdThen", { detail: "" }));
		expect(git.label!(0, "commit")).toBe("Open thread");
	});

	it("commits only after a keypad hold, or on a Ring click, with T3 Code's own message", async () => {
		vi.useFakeTimers();
		const { git, thread: open } = keys();
		git.press!(0, "commit", 100);
		expect(git.label!(0, "commit")).toBe(t("repo.holdTo"));
		expect(open!.machine.stream).not.toHaveBeenCalled();
		git.press!(0, "commit");
		await vi.advanceTimersByTimeAsync(0);
		const sent = vi.mocked(open!.machine.stream).mock.calls[0]![1] as Record<string, unknown>;
		expect(sent).toMatchObject({ action: "commit", cwd: "/work/project" });
		expect(sent.commitMessage).toBeUndefined();
	});

	it("holds Fix findings on a keypad and asks about the pull request on a tap", async () => {
		vi.useFakeTimers();
		const { pr, openThread, thread: open } = keys();
		pr.face(0, "fix", 116);
		await vi.advanceTimersByTimeAsync(0);
		pr.press!(0, "fix", 100);
		expect(pr.label!(0, "fix")).toBe(t("repo.holdTo"));
		expect(open!.machine.send).not.toHaveBeenCalled();
		pr.press!(0, "ask", 0);
		expect(openThread).toHaveBeenCalledExactlyOnceWith(open);
	});
});

describe("sharedKind over Open, Health, Update T3, Share Thread and Usage", () => {
	const service = { serverVersion: "1.0.0", capabilities: { serverSelfUpdate: "boot-service", serverSelfUpdateProgress: true } };

	/** The sidecar's runtime over one machine and its open thread, with these kinds as kinds.ts registers them. */
	function keys(overrides: Parameters<typeof machine>[0] = {}) {
		const owner = machine({ url: "http://admin-keys:3773", editors: ["vscode"], updateEnvironment: service, refreshConfig: vi.fn(async () => undefined), guestShare: vi.fn(async () => null), rpc: { "preview.list": { sessions: [], revision: 0 } }, ...overrides });
		const open = thread({ title: "Open thread", machine: owner });
		const board = { threads: [open], threadsOn: () => [open], selectedOn: () => open } as unknown as ThreadBoard;
		const repaint = vi.fn();
		const warn = vi.fn<(message: string) => void>();
		const runtime = logiRuntime({ machines: () => [owner], board, openThread: async () => undefined, selectThread: () => undefined, repaint, warn });
		const updateKey = createUpdateKey();
		const update = sharedKind("update", updateKey, { "": {} }, runtime);
		updateKey.onResult((_url, label) => update.flash("", label));
		return {
			owner,
			update,
			open: sharedKind("open", openKey, { editor: { mode: "editor" }, preview: { mode: "preview" } }, runtime),
			health: sharedKind("health", healthKey, { "": {} }, runtime),
			share: sharedKind("share", shareKey, { "": {} }, runtime),
			usage: sharedKind("usage", usageKey, { "": {} }, runtime),
		};
	}

	it("draws their Ring glyphs and keypad tiles", async () => {
		const { open, health, update, share, usage } = keys();
		share.face(0, "", 80);
		// The preview's tabs, then (with none) its newest HTML render, are read in turn.
		open.face(0, "preview", 80);
		await settle();
		open.face(0, "preview", 80);
		await settle();
		await expect(open.face(0, "editor", 80)).toMatchFileSnapshot("./__goldens__/sharedOpen-editor-80.svg");
		await expect(open.face(0, "editor", 116)).toMatchFileSnapshot("./__goldens__/sharedOpen-editor-116.svg");
		await expect(open.face(0, "preview", 80)).toMatchFileSnapshot("./__goldens__/sharedOpen-preview-80.svg");
		await expect(health.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedHealth-80.svg");
		await expect(update.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedUpdate-needsAccess-80.svg");
		await expect(update.face(0, "", 116)).toMatchFileSnapshot("./__goldens__/sharedUpdate-needsAccess-116.svg");
		await expect(share.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedShare-needsAccess-80.svg");
		await expect(share.face(0, "", 116)).toMatchFileSnapshot("./__goldens__/sharedShare-needsAccess-116.svg");
		await expect(usage.face(0, "", 80)).toMatchFileSnapshot("./__goldens__/sharedUsage-80.svg");
		expect(open.label!(0, "editor")).toBe("VS Code");
		expect(open.face(0, "", 80)).toBeUndefined();
	});

	it("shows Update T3 and Share Thread unavailable, as Logitech pairings never get their access", async () => {
		const { update, share } = keys();
		share.face(0, "", 80);
		await settle();
		expect(update.face(0, "", 80)).toBe(ringFace(COLORS.accent, "update", { dim: true }));
		expect(update.label!(0, "")).toBe(needsAccessLabel("environment:maintain"));
		expect(share.face(0, "", 80)).toBe(ringFace(COLORS.accent, "share", { dim: true }));
		expect(share.label!(0, "")).toBe(needsAccessLabel("access:write"));
		expect(update.face(0, "", 116)).toContain('<g opacity=".5">');
		expect(share.face(0, "", 116)).toContain('<g opacity=".5">');
	});

	it("never asks for access on Logitech, only says it's needed", () => {
		vi.useFakeTimers();
		const { update, share } = keys();
		update.press!(0, "");
		expect(update.label!(0, "")).toBe(needsAccessLabel("environment:maintain"));
		share.face(0, "", 80);
		return vi.advanceTimersByTimeAsync(0).then(async () => {
			share.press!(0, "");
			await vi.advanceTimersByTimeAsync(0);
			expect(share.label!(0, "")).toBe(needsAccessLabel("access:write"));
		});
	});

	it("reads the config again before a Share press while guest links look off", async () => {
		vi.useFakeTimers();
		const { share, owner } = keys({ guestLinksEnabled: false });
		share.face(0, "", 80);
		await vi.advanceTimersByTimeAsync(0);
		share.press!(0, "");
		await vi.advanceTimersByTimeAsync(0);
		expect(owner.refreshConfig).toHaveBeenCalledOnce();
		expect(share.label!(0, "")).toBe(t("share.disabled"));
	});
});
