import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { modelConfig, scene, STATES, thread } from "../../actions/testing/fixtures.js";
import type { GoldenOptions } from "../../actions/testing/harness.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import type { MotionMode } from "../motion.js";
import { resolveTarget, type TargetSettings } from "../target.js";
import type { KeyContext, KeyDefinition, KeyRuntime, PressPlan } from "./key.js";
import { effortKey, modelKey, permissionsKey, planKey, speedKey } from "./power.js";

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

// The clock the Stream Deck goldens were recorded at.
beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

/** A context as Stream Deck's test deck gives it: Max effort Solid, Ultrathink never armed. */
function context<S>(world: GoldenOptions, settings: S, motion: MotionMode = "off"): KeyContext<S> {
	const threads = world.threads ?? [];
	const machines = world.machines ?? [...new Set(threads.map((each) => each.machine))];
	const runtime = {
		board: { threadsOn: () => threads, selectedOn: () => world.selected },
		machines: () => machines,
		motion: () => motion,
		appearance: () => ({ confirmSend: "off", maxEffort: "solid" }),
		acpIcons: {},
		ultrathink: { armed: () => false },
	} as unknown as KeyRuntime;
	const lookup = (key: string) => {
		const found = threads.find((each) => each.key === key);
		return found === undefined ? ({ state: "gone" } as const) : ({ state: "found", thread: found } as const);
	};
	return { settings, machine: undefined, runtime, target: () => resolveTarget<DeckThread>(settings as TargetSettings, () => world.selected, lookup) };
}

const face = <S, St>(key: KeyDefinition<S, St>, ctx: KeyContext<S>): string => decoded(key.tile(key.state(ctx), ctx));
const plan = <S, St>(key: KeyDefinition<S, St>, ctx: KeyContext<S>): PressPlan => key.press(key.state(ctx), ctx, { heldMs: 0, confirmBy: "settings" });

const pinnedScene = (): GoldenOptions => {
	const base = scene({ threadId: "pinned-one", title: "Pinned one" });
	const other = thread({ threadId: "other-one", title: "Other one", machine: base.threads![0]!.machine });
	return { threads: [...base.threads!, other], selected: other };
};
const PIN = { target: "thread", thread: "env/pinned-one", threadTitle: "Pinned one" };
const GONE = { target: "thread", thread: "env/gone", threadTitle: "Old thread" };
const fastThread = () => scene({ model: { instanceId: "codex", model: "gpt-5", options: [{ id: "serviceTier", value: "fast" }] } });
const claude = (extra: Partial<DeckThread> = {}) => scene({ model: { instanceId: "claudeAgent", model: "opus" }, ...extra });
const effortAt = (value: string) => () => scene({ model: { instanceId: "codex", model: "gpt-5", options: [{ id: "reasoningEffort", value }] } });

type Case = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>];
const connection: Case[] = [
	["no-thread", STATES["no-thread"]],
	["read-only", STATES["read-only"]],
];

/** Each face equals the golden Stream Deck's key recorded for it. */
function faces<S, St>(prefix: string, key: KeyDefinition<S, St>, cases: Case[]): void {
	it.each(cases)(`${prefix}-%s`, (name, make, settings) => expect(face(key, context(make(), (settings ?? {}) as S))).toBe(golden(`${prefix}-${name}`)));
}

/** What a press does, run and observed on the thread's machine, as each press golden recorded. */
async function pressed<S, St>(key: KeyDefinition<S, St>, world: GoldenOptions, settings: object = {}) {
	const result = plan(key, context(world, settings as S));
	if (result.kind === "run") await result.work().catch(() => undefined);
	const target = world.selected?.machine;
	return { result, target, thread: world.selected };
}

describe("Model", () => {
	faces("model", modelKey, [
		...connection,
		["cycle", STATES.idle],
		["cycle-claude", () => claude()],
		["fixed", STATES.idle, { model: "codex:gpt-5-mini" }],
		["fixed-current", STATES.idle, { model: "codex:gpt-5" }],
		["fixed-missing", STATES.idle, { model: "codex:nope" }],
		["white-name", STATES.idle, { nameColor: "white" }],
		["unknown-model", () => scene({ model: { instanceId: "codex", model: "gone" } })],
		["no-config", () => scene({}, { modelConfig: undefined })],
		["pinned", pinnedScene, PIN],
		["pinned-gone", pinnedScene, GONE],
	]);

	it("presses as recorded", async () => {
		const cycle = await pressed(modelKey, scene());
		expect(cycle.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(cycle.thread, { instanceId: "codex", model: "gpt-5-mini" });
		const other = await pressed(modelKey, scene(), { model: "claudeAgent:opus" });
		expect(other.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(other.thread, { instanceId: "claudeAgent", model: "opus" });
		expect((await pressed(modelKey, scene(), { model: "codex:gpt-5" })).result).toEqual({ kind: "nothing" });
		expect((await pressed(modelKey, scene(), { model: "codex:nope" })).result).toEqual({ kind: "fail", label: t("reason.unavailable") });
		expect((await pressed(modelKey, STATES["no-thread"]())).result).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect((await pressed(modelKey, STATES["read-only"]())).result).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});

	it("takes a picker slot to the nth model in T3 Code's picker, as Logitech's Model n", async () => {
		const favorites = { ...modelConfig(), settings: { favorites: [{ provider: "codex", model: "gpt-5" }, { provider: "claudeAgent", model: "opus" }] } };
		const second = await pressed(modelKey, scene({}, { modelConfig: favorites }), { pickerSlot: 2 });
		expect(second.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(second.thread, { instanceId: "claudeAgent", model: "opus" });
		expect((await pressed(modelKey, scene({}, { modelConfig: favorites }), { pickerSlot: 1 })).result).toEqual({ kind: "nothing" });
		expect((await pressed(modelKey, scene({}, { modelConfig: favorites }), { pickerSlot: 3 })).result).toEqual({ kind: "fail", label: t("reason.unavailable") });
	});
});

describe("Effort", () => {
	faces("effort", effortKey, [
		...connection,
		["cycle", STATES.idle],
		["low", effortAt("low")],
		["high", effortAt("high")],
		["fixed", STATES.idle, { effort: "high" }],
		["fixed-current", STATES.idle, { effort: "medium" }],
		["fixed-not-offered", STATES.idle, { effort: "xhigh" }],
		["no-effort", () => scene({ model: { instanceId: "codex", model: "gpt-5-mini" } })],
		["claude", () => claude()],
		["pinned", pinnedScene, PIN],
	]);

	it("effort-high-full twinkles under full Motion", () => {
		const ctx = context(effortAt("high")(), {}, "full");
		expect(face(effortKey, ctx)).toBe(golden("effort-high-full"));
		expect(effortKey.moving!(effortKey.state(ctx))).toBe(true);
		expect(effortKey.moving!(effortKey.state(context(effortAt("high")(), {})))).toBe(false);
	});

	it("presses as recorded", async () => {
		const high = { instanceId: "codex", model: "gpt-5", options: [{ id: "reasoningEffort", value: "high" }] };
		const cycle = await pressed(effortKey, scene());
		expect(cycle.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(cycle.thread, high);
		const fixed = await pressed(effortKey, scene(), { effort: "high" });
		expect(fixed.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(fixed.thread, high);
		expect((await pressed(effortKey, scene(), { effort: "medium" })).result).toEqual({ kind: "nothing" });
		expect((await pressed(effortKey, scene(), { effort: "xhigh" })).result).toEqual({ kind: "fail", label: t("reason.notOffered") });
		expect((await pressed(effortKey, scene({ model: { instanceId: "codex", model: "gpt-5-mini" } }))).result).toEqual({ kind: "fail", label: t("reason.noEffort") });
		expect((await pressed(effortKey, STATES["no-thread"]())).result).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect((await pressed(effortKey, STATES["read-only"]())).result).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});
});

describe("Speed", () => {
	faces("speed", speedKey, [
		...connection,
		["standard", STATES.idle],
		["fast", fastThread],
		["claude-standard", () => claude()],
		["claude-fast", () => claude({ model: { instanceId: "claudeAgent", model: "opus", options: [{ id: "fastMode", value: true }] } })],
		["no-fast", () => scene({ model: { instanceId: "codex", model: "gpt-5-mini" } })],
		["pinned", pinnedScene, PIN],
	]);

	it("presses as recorded", async () => {
		const toFast = await pressed(speedKey, scene());
		expect(toFast.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(toFast.thread, { instanceId: "codex", model: "gpt-5", options: [{ id: "serviceTier", value: "fast" }] });
		const toStandard = await pressed(speedKey, fastThread());
		expect(toStandard.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(toStandard.thread, { instanceId: "codex", model: "gpt-5", options: [{ id: "serviceTier", value: "default" }] });
		const opus = await pressed(speedKey, claude());
		expect(opus.target!.setModelSelection).toHaveBeenCalledExactlyOnceWith(opus.thread, { instanceId: "claudeAgent", model: "opus", options: [{ id: "fastMode", value: true }] });
		expect((await pressed(speedKey, scene({ model: { instanceId: "codex", model: "gpt-5-mini" } }))).result).toEqual({ kind: "fail", label: t("reason.noFastMode") });
		expect((await pressed(speedKey, STATES["no-thread"]())).result).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect((await pressed(speedKey, STATES["read-only"]())).result).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});
});

describe("Permissions", () => {
	faces("permissions", permissionsKey, [
		...connection,
		["supervised", STATES.idle],
		["auto-accept", () => scene({ runtimeMode: "auto-accept-edits" })],
		["auto", () => scene({ runtimeMode: "auto" })],
		["full", () => scene({ runtimeMode: "full-access" })],
		["claude", () => claude()],
		["claude-full", () => claude({ runtimeMode: "full-access" })],
		["fixed", STATES.idle, { mode: "full-access" }],
		["fixed-current", () => scene({ runtimeMode: "full-access" }), { mode: "full-access" }],
		["fixed-not-offered", () => claude(), { mode: "auto" }],
		["pinned", pinnedScene, PIN],
	]);

	it("presses as recorded", async () => {
		const cycle = await pressed(permissionsKey, scene());
		expect(cycle.target!.setRuntimeMode).toHaveBeenCalledExactlyOnceWith(cycle.thread, "auto-accept-edits");
		const opus = await pressed(permissionsKey, claude());
		expect(opus.target!.setRuntimeMode).toHaveBeenCalledExactlyOnceWith(opus.thread, "full-access");
		const fixed = await pressed(permissionsKey, scene(), { mode: "full-access" });
		expect(fixed.target!.setRuntimeMode).toHaveBeenCalledExactlyOnceWith(fixed.thread, "full-access");
		expect((await pressed(permissionsKey, scene({ runtimeMode: "full-access" }), { mode: "full-access" })).result).toEqual({ kind: "nothing" });
		expect((await pressed(permissionsKey, claude(), { mode: "auto" })).result).toEqual({ kind: "fail", label: t("reason.notOffered") });
		expect((await pressed(permissionsKey, STATES["no-thread"]())).result).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect((await pressed(permissionsKey, STATES["read-only"]())).result).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});
});

describe("Plan", () => {
	faces("plan", planKey, [
		...connection,
		["build", STATES.idle],
		["plan", () => scene({ interactionMode: "plan" })],
		["unsupported", () => scene({}, { modelConfig: modelConfig({ codexPlanToggle: false }) })],
		["pinned", pinnedScene, PIN],
	]);

	it("presses as recorded", async () => {
		const toPlan = await pressed(planKey, scene());
		expect(toPlan.target!.setInteractionMode).toHaveBeenCalledExactlyOnceWith(toPlan.thread, "plan");
		const toBuild = await pressed(planKey, scene({ interactionMode: "plan" }));
		expect(toBuild.target!.setInteractionMode).toHaveBeenCalledExactlyOnceWith(toBuild.thread, "default");
		expect((await pressed(planKey, scene({}, { modelConfig: modelConfig({ codexPlanToggle: false }) }))).result).toEqual({ kind: "fail", label: t("reason.noPlanMode") });
		expect((await pressed(planKey, STATES["no-thread"]())).result).toEqual({ kind: "fail", label: t("reason.noThread") });
		expect((await pressed(planKey, STATES["read-only"]())).result).toEqual({ kind: "fail", label: t("reason.readOnly") });
	});
});

