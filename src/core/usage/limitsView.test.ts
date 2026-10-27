import { describe, expect, it } from "vitest";

import { renderGaugeKey } from "../gauge.js";
import { accountName, creditsText, findWindow, limitGauge, limitPools, limitTiles, outcomeText, resetTarget, resetText, windowChoices, windowLabel } from "./limitsView.js";
import type { ServerProviderUsageLimits } from "./types.js";

const now = Date.parse("2026-10-27T10:42:00.000Z");
const checkedAt = "2026-10-27T10:40:00.000Z";

const codexLimits = (used: number, extra: Partial<ServerProviderUsageLimits> = {}): ServerProviderUsageLimits => ({
	checkedAt,
	windows: [
		{ id: "primary", kind: "session", label: "Session", usedPercent: used, resetsAt: "2026-10-27T13:05:00.000Z", windowDurationMins: 300 },
		{ id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 62, resetsAt: "2026-10-31T08:00:00.000Z", windowDurationMins: 10_080 },
		{ id: "future", kind: "yearly" as "other", label: "Yearly", usedPercent: 1 },
	],
	...extra,
});

const machine = (environmentId: string, providers: unknown[], sources?: unknown[]) => ({ environmentId, label: environmentId, providers: providers as never, sources: sources as never });
const codex = (email: string, limits: ServerProviderUsageLimits, instanceId = "codex") => ({ instanceId, driver: "codex", enabled: true, installed: true, models: [], auth: { email }, usageLimits: limits });

describe("limits on the deck", () => {
	it("pools the spec's example: one native and one hub Codex account", () => {
		const hub = {
			id: "hub-1",
			kind: "cliproxy",
			label: "proxy.local:8317",
			checkedAt,
			accounts: [
				{
					id: "codex-second@example.com.json",
					driver: "codex",
					email: "second@example.com",
					usageLimits: {
						checkedAt,
						windows: [
							{ id: "primary", kind: "session", label: "Session", usedPercent: 100, resetsAt: "2026-10-27T11:30:00.000Z", windowDurationMins: 300 },
							{ id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 40, resetsAt: "2026-11-01T00:00:00.000Z", windowDurationMins: 10_080 },
						],
						resetCredits: { availableCount: 1, nextCreditId: "cr_123" },
					},
				},
			],
		};
		const pools = limitPools([machine("env-1", [codex("dev@example.com", codexLimits(37, { resetCredits: { availableCount: 2 } }))], [hub])], now);
		expect(pools).toHaveLength(1);
		const pool = pools[0]!;
		const session = findWindow(pool, "session")!;
		expect(session.remainingPercent).toBe(32);
		expect(pool.windows.map((window) => window.kind)).toEqual(["session", "weekly"]);

		const gauge = limitGauge(pool, session, now, "left");
		expect(gauge).toMatchObject({ label: "5-hour", percent: 32, credits: 3, stale: false, accounts: 2, resetAt: Date.parse("2026-10-27T11:30:00.000Z") });
		expect(limitGauge(pool, session, now, "used").percent).toBe(69);
		// The hub account first: its session resets sooner; it holds the redeemable credit too.
		expect(accountName(resetTarget(pool)!)).toBe("second@example.com");
	});

	it("labels plain windows by length and keeps T3 Code's own labels otherwise", () => {
		const pool = limitPools([machine("env-1", [codex("a@b.c", codexLimits(10))])], now)[0]!;
		expect(pool.windows.map(windowLabel)).toEqual(["5-hour", "Weekly"]);
		expect(windowLabel({ kind: "weekly", label: "Weekly · Opus", members: [] })).toBe("Weekly · Opus");
		expect(windowLabel({ kind: "session", label: "Session", members: [] })).toBe("Session");
		expect(windowChoices(pool)).toEqual([
			{ value: "session", label: "5-hour" },
			{ value: "weekly", label: "Weekly" },
		]);
	});

	it("finds a window by id, then by kind, and drops windows of unknown kinds", () => {
		const claude = {
			instanceId: "claudeAgent",
			driver: "claudeAgent",
			enabled: true,
			installed: true,
			models: [],
			auth: { email: "c@d.e" },
			usageLimits: {
				checkedAt,
				windows: [
					{ id: "five_hour", kind: "session", label: "Session", usedPercent: 20, windowDurationMins: 300, resetsAt: "2026-10-27T12:00:00.000Z" },
					{ id: "seven_day", kind: "weekly", label: "Weekly", usedPercent: 30 },
					{ id: "seven_day_opus", kind: "weekly", label: "Weekly · Opus", usedPercent: 50 },
				],
			},
		};
		const pool = limitPools([machine("env-1", [claude])], now)[0]!;
		expect(findWindow(pool, "weekly")?.id).toBe("seven_day");
		expect(findWindow(pool, "seven_day_opus")?.label).toBe("Weekly · Opus");
		expect(findWindow(pool, "")?.id).toBe("five_hour");
		expect(findWindow(pool, "monthly")).toBeUndefined();
		expect(windowChoices(pool).map((choice) => choice.value)).toEqual(["session", "weekly", "seven_day_opus"]);
		expect(limitTiles([pool]).map((tile) => tile.key)).toEqual(["claudeAgent|five_hour", "claudeAgent|seven_day", "claudeAgent|seven_day_opus"]);
	});

	it("leaves out providers that are off, not installed, unavailable or without limits", () => {
		const limits = codexLimits(10);
		const pools = limitPools(
			[
				machine("env-1", [
					{ ...codex("a@b.c", limits), enabled: false },
					{ ...codex("d@b.c", limits, "codex-2"), installed: false },
					{ ...codex("e@b.c", limits, "codex-3"), availability: "unavailable" },
					{ ...codex("f@b.c", { checkedAt, windows: [] }, "codex-4") },
				]),
			],
			now,
		);
		expect(pools).toEqual([]);
	});

	it("goes stale 15 minutes after the read, and marks where even pace is", () => {
		const pool = limitPools([machine("env-1", [codex("a@b.c", codexLimits(37))])], now)[0]!;
		const session = findWindow(pool, "session")!;
		// 143 of 300 minutes left: even pace would leave 48%.
		expect(limitGauge(pool, session, now, "left").pace).toBe(48);
		expect(limitGauge(pool, session, now, "used").pace).toBe(52);
		expect(limitGauge(pool, session, Date.parse(checkedAt) + 15 * 60_000, "left").stale).toBe(true);
	});

	it("words resets and outcomes", () => {
		expect(resetText(now - 1, now)).toBe("Resets now");
		expect(resetText(now + 3_600_000, now)).toBe(new Date(now + 3_600_000).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }));
		expect(resetText(now + 3 * 86_400_000, now)).toBe(new Date(now + 3 * 86_400_000).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
		expect([creditsText(0), creditsText(1), creditsText(3)]).toEqual(["", "1 reset", "3 resets"]);
		expect(outcomeText({ outcome: "nothingToReset" })).toBe("Nothing to reset");
		expect(outcomeText({ outcome: "reset", warning: "Applied; the hub keeps its cooldown." })).toBe("Applied; the hub keeps its cooldown.");
	});

	it("draws the key with its bar filled to the figure", () => {
		const svg = Buffer.from(renderGaugeKey({ label: "Weekly", value: "61%", lines: ["Aug 28", "3 resets"], fill: 0.61, marker: 0.5 }).split(",")[1]!, "base64").toString();
		expect(svg).toContain(">Weekly<");
		expect(svg).toContain(">61%<");
		expect(svg).toContain(`height="68"`);
		expect(svg).toContain(">3 resets<");
	});
});
