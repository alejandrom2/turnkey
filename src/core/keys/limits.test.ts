import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { machine } from "../../actions/testing/fixtures.js";
import { failureLabel } from "../feedback.js";
import { t } from "../i18n.js";
import { limitsFace, limitsLabel } from "../ring.js";
import { needsAccessLabel } from "../scopes.js";
import type { Machine } from "../t3/machine.js";
import type { KeyContext, KeyRuntime, PressInput, PressPlan } from "./key.js";
import { limitsKey, type LimitsSettings } from "./limits.js";

// Reset times print in the machine's time zone, as the Stream Deck goldens were recorded in.
vi.hoisted(() => void (process.env.TZ = "UTC"));

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

const FRESH = "2026-06-01T11:58:00Z";
const STALE = "2026-06-01T08:00:00Z";
const windows = (used: number) => [
	{ id: "primary", kind: "session", label: "Session", usedPercent: used, resetsAt: "2026-06-01T15:00:00Z", windowDurationMins: 300 },
	{ id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 62, resetsAt: "2026-06-05T08:00:00Z", windowDurationMins: 10_080 },
];
const provider = (driver: string, usageLimits: unknown, extra: Record<string, unknown> = {}) => ({ instanceId: driver, driver, enabled: true, installed: true, models: [], auth: { email: `${driver}@example.test` }, usageLimits, ...extra });
const limits = (used = 37, extra: Record<string, unknown> = {}) => ({ checkedAt: FRESH, windows: windows(used), ...extra });
const codex = (used = 37, extra: Record<string, unknown> = {}) => provider("codex", limits(used, extra));
const PROVIDERS = ["orchestration:read", "orchestration:operate", "providers:manage"];

let next = 0;
const reporting = (providers: unknown[], extra: Parameters<typeof machine>[0] = {}): Machine => {
	const environmentId = `limits-core-${next++}`;
	return machine({ url: "http://studio:3773", environmentId, state: { kind: "ready", environmentId, label: "Studio", canOperate: true }, modelConfig: { providers }, ...extra });
};

/** A context as Stream Deck's test deck gives it (English, the `t3` scheme, opt-in access), or Logitech's (`logi`). */
function context(machines: Machine[], settings: LimitsSettings = {}, logi = false) {
	const runtime = {
		machines: () => machines,
		repaint: vi.fn(),
		warn: vi.fn(),
		locale: () => "en",
		scheme: () => "t3",
		openExternal: vi.fn(async () => undefined),
		optIn: logi ? undefined : { requested: () => false, request: vi.fn(async () => undefined) },
	};
	const ctx: KeyContext<LimitsSettings> = { settings, machine: undefined, runtime: runtime as unknown as KeyRuntime, target: () => ({ thread: undefined, pinned: false }) };
	return { ctx, runtime };
}

const face = (ctx: KeyContext<LimitsSettings>) => decoded(limitsKey.tile(limitsKey.state(ctx), ctx));
const plan = (ctx: KeyContext<LimitsSettings>, input: PressInput = { heldMs: 0, confirmBy: "settings" }): PressPlan => limitsKey.press(limitsKey.state(ctx), ctx, input);
const HOLD: PressInput = { heldMs: 600, confirmBy: "settings" };

/** A run plan's work, and the label a failure would flash. */
async function ran(result: PressPlan): Promise<string | undefined> {
	if (result.kind !== "run") throw new Error(`expected a run, got ${result.kind}`);
	return result.work().then(
		() => undefined,
		(error: unknown) => failureLabel(error),
	);
}

describe("Limits", () => {
	it.each([
		["no-limits", () => [reporting([])]],
		["no-limits-provider", () => [reporting([provider("codex", undefined)])]],
		["unavailable", () => [reporting([provider("codex", { checkedAt: FRESH, windows: [], unavailable: { reason: "unsupported" } })])]],
		["left", () => [reporting([codex()])]],
		["used", () => [reporting([codex()])], { show: "used" }],
		["weekly", () => [reporting([codex()])], { window: "weekly" }],
		["window-by-id", () => [reporting([codex()])], { window: "secondary" }],
		["window-missing", () => [reporting([codex()])], { window: "monthly" }],
		["full", () => [reporting([codex(0)])]],
		["empty", () => [reporting([codex(100)])]],
		["stale", () => [reporting([provider("codex", limits(37, { checkedAt: STALE }))])]],
		["credits", () => [reporting([codex(37, { resetCredits: { availableCount: 2 } })])]],
		["credit", () => [reporting([codex(37, { resetCredits: { availableCount: 1 } })])]],
		["credits-spend", () => [reporting([codex(37, { resetCredits: { availableCount: 2 } })])], { resetAction: "spend" }],
		["credits-spend-allowed", () => [reporting([codex(37, { resetCredits: { availableCount: 2 } })], { scopes: PROVIDERS })], { resetAction: "spend" }],
		["claude", () => [reporting([codex(), provider("claudeAgent", limits(80))])], { provider: "claudeAgent" }],
		["first-of-two", () => [reporting([codex(), provider("claudeAgent", limits(80))])]],
		["provider-missing", () => [reporting([codex()])], { provider: "cursor" }],
		["two-accounts", () => [reporting([codex(), provider("codex", limits(50), { instanceId: "codex-work", auth: { email: "work@example.test" } })])]],
		["reset-in-days", () => [reporting([provider("codex", { checkedAt: FRESH, windows: [{ id: "w", kind: "monthly", label: "Monthly", usedPercent: 10, resetsAt: "2026-06-20T00:00:00Z", windowDurationMins: 43_200 }] })])]],
		["reset-passed", () => [reporting([provider("codex", { checkedAt: FRESH, windows: [{ id: "w", kind: "session", label: "Session", usedPercent: 10, resetsAt: "2026-06-01T11:00:00Z", windowDurationMins: 300 }] })])]],
	] as [string, () => Machine[], LimitsSettings?][])("limits-%s", (name, make, settings) => expect(face(context(make(), settings).ctx)).toBe(golden(`limits-${name}`)));

	it("refreshes every machine on a tap", async () => {
		const studio = reporting([codex()]);
		const result = plan(context([studio]).ctx);
		expect(result).toEqual({ kind: "run", work: expect.any(Function) });
		expect(await ran(result)).toBeUndefined();
		expect(studio.refreshProviders).toHaveBeenCalled();
	});

	it("says to hold, on a tap, while it spends and a reset is banked", () => {
		expect(plan(context([reporting([codex(37, { resetCredits: { availableCount: 2 } })])], { resetAction: "spend" }).ctx)).toMatchObject({ kind: "run", notice: t("limits.holdToReset") });
		expect(plan(context([reporting([codex(37, { resetCredits: { availableCount: 2 } })])]).ctx)).not.toHaveProperty("notice");
	});

	it("opens T3 Code's Usage page on a hold", async () => {
		const { ctx, runtime } = context([reporting([codex()])]);
		expect(await ran(plan(ctx, HOLD))).toBeUndefined();
		expect(runtime.openExternal).toHaveBeenCalledExactlyOnceWith("t3://usage");
	});

	it("spends a banked reset on a hold, and says how it went", async () => {
		const spent = reporting([codex(37, { resetCredits: { availableCount: 2 } })], { scopes: PROVIDERS });
		expect(await ran(plan(context([spent], { resetAction: "spend" }).ctx, HOLD))).toBeUndefined();
		expect(spent.consumeResetCredit).toHaveBeenCalledExactlyOnceWith({ instanceId: "codex" });
		const nothing = reporting([codex(37, { resetCredits: { availableCount: 1 } })], { scopes: PROVIDERS, consumeResetCredit: vi.fn(async () => ({ outcome: "nothingToReset", warning: "Nothing to reset." })) });
		expect(await ran(plan(context([nothing], { resetAction: "spend" }).ctx, HOLD))).toBe("codex@example.test: Nothing to reset.");
		expect(await ran(plan(context([reporting([codex()], { scopes: PROVIDERS })], { resetAction: "spend" }).ctx, HOLD))).toBe(t("limits.noResets"));
	});

	it("asks for provider access before saying a spend needs it; Logitech only says so", async () => {
		const { ctx, runtime } = context([reporting([codex(37, { resetCredits: { availableCount: 2 } })])], { resetAction: "spend" });
		expect(await ran(plan(ctx, HOLD))).toBe(needsAccessLabel("providers:manage"));
		expect(runtime.optIn!.request).toHaveBeenCalledExactlyOnceWith("http://studio:3773", "providers:manage");
		const logi = context([reporting([codex(37, { resetCredits: { availableCount: 2 } })])], { resetAction: "spend" }, true);
		expect(await ran(plan(logi.ctx, { heldMs: 900, confirmBy: "hold" }))).toBe(needsAccessLabel("providers:manage"));
	});

	it("draws Logitech's limit n, and with no slot the tightest window of all, without a mark", () => {
		const machines = [reporting([codex(20), provider("claudeAgent", limits(80))])];
		const glyph = (settings: LimitsSettings) => {
			const { ctx } = context(machines, settings, true);
			const state = limitsKey.state(ctx);
			return [limitsKey.glyph!(state, ctx), limitsKey.label!(state, ctx)];
		};
		expect(glyph({ poolSlot: 1 })).toEqual([limitsFace(62, false, "codex"), limitsLabel("codex", "Weekly", 62)]);
		expect(glyph({ poolSlot: 2 })).toEqual([limitsFace(80, false, "claudeAgent"), limitsLabel("claudeAgent", "5-hour", 80)]);
		expect(glyph({ poolSlot: 3 })).toEqual([limitsFace(undefined, false), undefined]);
		expect(glyph({})).toEqual([limitsFace(80, false), limitsLabel("claudeAgent", "5-hour", 80)]);
	});
});
