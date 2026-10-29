import { readFileSync } from "node:fs";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { machine } from "../../actions/testing/fixtures.js";
import type { Machine } from "../t3/machine.js";
import { UsageStore } from "../usage/store.js";
import { USAGE_CONTRACT_VERSION, type UsageBucket } from "../usage/types.js";
import type { KeyContext, KeyRuntime, PressInput } from "./key.js";
import { usageKey, type UsageSettings } from "./usage.js";

// The store's windows follow the time zone, as the Stream Deck goldens were recorded in.
vi.hoisted(() => void (process.env.TZ = "UTC"));

const golden = (name: string): string => readFileSync(new URL(`../../actions/__goldens__/${name}.svg`, import.meta.url), "utf8");
const decoded = (image: string): string => Buffer.from(image.slice(image.indexOf(",") + 1), "base64").toString("utf8");

beforeEach(() => void vi.useFakeTimers().setSystemTime(new Date("2026-06-01T12:00:00.250Z")));
afterEach(() => void vi.useRealTimers());

const bucket = (overrides: Partial<UsageBucket> = {}): UsageBucket => ({
	day: "2026-05-31",
	provider: "codex",
	model: "gpt-5",
	totals: { uncachedInputTokens: 120_000, cachedInputTokens: 900_000, cacheCreationTokens: 0, outputTokens: 40_000, reasoningTokens: 10_000 },
	costUsd: 12.5,
	cacheSavingsUsd: 3,
	costSource: "modelPriced",
	records: 40,
	unpricedRecords: 0,
	sessions: 4,
	...overrides,
});
const source = (provider: "codex" | "claude") => ({
	fingerprint: { hostId: "studio", provider, resolvedHomePath: `/home/${provider}`, volumeId: "vol" },
	status: "ok",
	scannedFiles: 4,
	skippedFiles: 0,
	malformedRecords: 0,
	distinctSessions: 4,
	message: null,
});
const summary = (buckets: UsageBucket[] = [bucket(), bucket({ provider: "claude", model: "opus", costUsd: 30, sessions: 2 })], overrides: Record<string, unknown> = {}) => ({
	contractVersion: USAGE_CONTRACT_VERSION,
	readAt: "2026-06-01T12:00:00Z",
	timeZone: "UTC",
	sinceDay: "2026-05-02",
	untilDay: "2026-06-01",
	buckets,
	sources: [source("codex"), source("claude")],
	pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 10 },
	scanDurationMs: 5,
	...overrides,
});

let next = 0;
const DIAGNOSTICS = ["orchestration:read", "orchestration:operate", "diagnostics:read"];
const reading = (usageSummary: () => Promise<unknown>, extra: Parameters<typeof machine>[0] = {}): Machine =>
	machine({ url: `http://usage-core-${next++}:3773`, scopes: DIAGNOSTICS, usageSummary: vi.fn(usageSummary), refreshUsageRates: vi.fn(async () => undefined), ...extra });

function context(machines: Machine[], settings: UsageSettings = {}): KeyContext<UsageSettings> {
	const repaint = vi.fn();
	const runtime = { machines: () => machines, repaint, warn: vi.fn(), usage: new UsageStore(repaint, () => Date.now(), () => undefined) } as unknown as KeyRuntime;
	return { settings, machine: undefined, runtime, target: () => ({ thread: undefined, pinned: false }) };
}

/** The face once the period has been read, as a shown key reads it. */
async function face(ctx: KeyContext<UsageSettings>): Promise<string> {
	usageKey.state(ctx);
	await vi.advanceTimersByTimeAsync(0);
	return decoded(usageKey.tile(usageKey.state(ctx), ctx));
}

describe("Usage", () => {
	it.each([
		["no-access", () => [machine({ url: `http://usage-core-${next++}:3773` })], {}],
		["loading", () => [reading(() => new Promise(() => undefined))], {}],
		["failed", () => [reading(async () => Promise.reject(new Error("boom")))], {}],
		["month", () => [reading(async () => summary())], {}],
		["week", () => [reading(async () => summary())], { period: "7" }],
		["provider-claude", () => [reading(async () => summary())], { provider: "claude" }],
		["server-behind", () => [reading(async () => summary(undefined, { contractVersion: 1 }))], {}],
		["two-machines", () => [reading(async () => summary([bucket()])), reading(async () => summary([bucket({ provider: "claude", model: "opus", costUsd: 30 })]))], {}],
	] as Array<[string, () => Machine[], UsageSettings]>)("usage-%s", async (name, make, settings) => expect(await face(context(make(), settings))).toBe(golden(`usage-${name}`)));

	const press = (ctx: KeyContext<UsageSettings>, input: PressInput) => usageKey.press(usageKey.state(ctx), ctx, input);

	it("reads the period again on a tap, and reloads prices first on a long press, on either platform", async () => {
		const shown = reading(async () => summary());
		const ctx = context([shown], { period: "7" });
		const tap = press(ctx, { heldMs: 0, confirmBy: "settings" });
		if (tap.kind !== "run") throw new Error(`expected a run, got ${tap.kind}`);
		await tap.work();
		expect(shown.refreshUsageRates).not.toHaveBeenCalled();
		expect(shown.usageSummary).toHaveBeenCalledWith({ sinceDay: "2026-05-26", untilDay: "2026-06-01", timeZone: "UTC", resolution: "day" });
		for (const input of [{ heldMs: 500, confirmBy: "settings" }, { heldMs: 500, confirmBy: "hold" }] as const) {
			const long = press(ctx, input);
			if (long.kind === "run") await long.work();
		}
		expect(shown.refreshUsageRates).toHaveBeenCalledTimes(2);
		// A Ring click reports no hold: a plain read.
		const click = press(ctx, { heldMs: 0, confirmBy: "click" });
		if (click.kind === "run") await click.work();
		expect(shown.refreshUsageRates).toHaveBeenCalledTimes(2);
	});

	it("fails a press without diagnostics access, saying so", async () => {
		const ctx = context([machine({ url: `http://usage-core-${next++}:3773` })]);
		const plan = press(ctx, { heldMs: 0, confirmBy: "click" });
		if (plan.kind !== "run") throw new Error(`expected a run, got ${plan.kind}`);
		await expect(plan.work()).rejects.toMatchObject({ requiredPermission: "diagnostics:read" });
	});

	it("dims the Ring's usage glyph until it can show a cost", async () => {
		const none = context([machine({ url: `http://usage-core-${next++}:3773` })]);
		expect(usageKey.available!(usageKey.state(none))).toBe(false);
		const ctx = context([reading(async () => summary())]);
		await face(ctx);
		expect(usageKey.available!(usageKey.state(ctx))).toBe(true);
	});
});
