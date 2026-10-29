import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { machine, NOW, scene, STATES, thread, uniqueUrl } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import { renderReviewKey } from "../render.js";
import { resolveTarget, type TargetSettings } from "../target.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { organizeKey, type OrganizeSettings } from "./organize.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

function context(world: GoldenOptions, settings: OrganizeSettings): KeyContext<OrganizeSettings> {
	const threads = world.threads ?? [];
	const machines = world.machines ?? [...new Set(threads.map((each) => each.machine))];
	const runtime = { board: { threads, threadsOn: () => threads, selectedOn: () => world.selected }, machines: () => machines } as unknown as KeyRuntime;
	const lookup = (key: string) => {
		const found = threads.find((each) => each.key === key);
		return found === undefined ? ({ state: "gone" } as const) : ({ state: "found", thread: found } as const);
	};
	return { settings, machine: undefined, runtime, target: () => resolveTarget<DeckThread>(settings as TargetSettings, () => world.selected, lookup) };
}

const face = (world: GoldenOptions, settings: OrganizeSettings): string => {
	const ctx = context(world, settings);
	return decoded(organizeKey.tile(organizeKey.state(ctx), ctx));
};
const SETTINGS: PressInput = { heldMs: 0, confirmBy: "settings" };
const plan = (world: GoldenOptions, settings: OrganizeSettings, input: PressInput = SETTINGS): PressPlan => {
	const ctx = context(world, settings);
	return organizeKey.press(organizeKey.state(ctx), ctx, input);
};

const asleep = (): GoldenOptions => {
	const sleeper = thread({ threadId: "asleep", title: "Sleeping thread" });
	return { threads: [], machines: [machine({ url: uniqueUrl(), everyRow: [{ ...sleeper, snoozedAt: NOW - 60_000 }] })] };
};
const PIN = { target: "thread", thread: "env/pinned-one", threadTitle: "Pinned one" };
const GONE = { target: "thread", thread: "env/gone", threadTitle: "Old thread" };
const pinnedScene = (): GoldenOptions => {
	const base = scene({ threadId: "pinned-one", title: "Pinned one" });
	const other = thread({ threadId: "other-one", title: "Other one", machine: base.threads![0]!.machine });
	return { threads: [...base.threads!, other], selected: other };
};

describe("Organize", () => {
	const actions = ["settle", "pin", "unpin", "snooze", "archive", "mark_unread", "wake"] as const;
	it.each([
		...actions.map((organize) => [organize, organize === "wake" ? asleep : STATES.idle, { organize }] as const),
		["pin-pinned", () => scene({ pinned: true }), { organize: "pin" }],
		["unpin-unpinned", STATES.idle, { organize: "unpin" }],
		["snooze-30m", STATES.idle, { organize: "snooze", snoozeMinutes: 30 }],
		["snooze-1d", STATES.idle, { organize: "snooze", snoozeMinutes: 1440 }],
		["wake-nothing", () => ({ machines: [machine({ url: uniqueUrl() })] }), { organize: "wake" }],
		["no-thread", STATES["no-thread"], {}],
		["read-only", STATES["read-only"], {}],
		["targeted", pinnedScene, { ...PIN, organize: "archive" }],
		["targeted-gone", pinnedScene, { ...GONE, organize: "archive" }],
	] as Array<[string, () => GoldenOptions, OrganizeSettings]>)("organize-%s", (name, make, settings) => expect(face(make(), settings)).toBe(golden(`organize-${name}`)));

	it("goes through the key's Confirm setting on Stream Deck, with the card it reviews", async () => {
		const world = scene({ threadId: "organize-1" });
		const settle = plan(world, { organize: "settle" });
		if (settle.kind !== "guard") throw new Error(`expected a guard, got ${settle.kind}`);
		expect(settle.guard.scope).toBe(JSON.stringify(["settle", "env/organize-1", 60]));
		expect(settle.guard.holdHint).toBe(t("result.holdToSettle"));
		expect(renderReviewKey(settle.guard.card())).toBe(
			renderReviewKey({ glyph: "settle", verb: t("review.settle"), target: "Thread", footer: t("review.pressAgain") }),
		);
		const snooze = plan(world, { organize: "snooze", snoozeMinutes: 30 });
		if (snooze.kind !== "guard") throw new Error(`expected a guard, got ${snooze.kind}`);
		expect(snooze.guard.card().verb).toBe(t("review.snooze", { duration: "30m" }));
		await snooze.work("");
		expect(world.selected!.machine.snooze).toHaveBeenCalledExactlyOnceWith(world.selected, 30);
		// Every action passes the guard on Stream Deck: off for all but Settle and Snooze, as the key's confirm mode says.
		for (const organize of ["pin", "archive", "mark_unread"] as const) expect(plan(scene(), { organize }).kind).toBe("guard");
		const wake = plan(asleep(), { organize: "wake" });
		if (wake.kind !== "guard") throw new Error(`expected a guard, got ${wake.kind}`);
		await wake.work("");
	});

	it("flashes why it can't act, as recorded", () => {
		expect(plan(STATES["no-thread"](), { organize: "archive" })).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect(plan(STATES["read-only"](), { organize: "archive" })).toEqual({ kind: "fail", label: t("reason.readOnly") });
		expect(plan({ machines: [machine({ url: uniqueUrl() })] }, { organize: "wake" })).toEqual({ kind: "fail", label: t("organize.nothingSnoozed") });
	});

	it("on Logitech, archives only on a keypad hold or a Ring click, and the rest act on a tap", async () => {
		expect(plan(scene(), { organize: "archive" }, { heldMs: 0, confirmBy: "hold" })).toEqual({ kind: "needsHold", label: t("result.holdToArchive") });
		expect(plan(scene(), { organize: "archive" }, { heldMs: 600, confirmBy: "hold" }).kind).toBe("run");
		expect(plan(scene(), { organize: "archive" }, { heldMs: 0, confirmBy: "click" }).kind).toBe("run");
		const world = scene({ pinned: true });
		const unpin = plan(world, { organize: "pin" }, { heldMs: 0, confirmBy: "hold" });
		if (unpin.kind !== "run") throw new Error(`expected a run, got ${unpin.kind}`);
		await unpin.work();
		expect(world.selected!.machine.unpin).toHaveBeenCalledExactlyOnceWith(world.selected);
		const snooze = scene();
		const snoozed = plan(snooze, { organize: "snooze" }, { heldMs: 0, confirmBy: "hold" });
		if (snoozed.kind === "run") await snoozed.work();
		expect(snooze.selected!.machine.snooze).toHaveBeenCalledExactlyOnceWith(snooze.selected, 60);
	});
});
