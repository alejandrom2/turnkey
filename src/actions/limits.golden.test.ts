import { describe, it, vi } from "vitest";

import { LimitsKey } from "./limits.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, STATES } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));
// Reset times print in the machine's time zone.
vi.hoisted(() => void (process.env.TZ = "UTC"));

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

type Setup = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>, held?: number | number[]];

const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};
const presses = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings, held] of setups) it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
};

const FRESH = "2026-06-01T11:58:00Z";
const STALE = "2026-06-01T08:00:00Z";

const windows = (used: number) => [
	{ id: "primary", kind: "session", label: "Session", usedPercent: used, resetsAt: "2026-06-01T15:00:00Z", windowDurationMins: 300 },
	{ id: "secondary", kind: "weekly", label: "Weekly", usedPercent: 62, resetsAt: "2026-06-05T08:00:00Z", windowDurationMins: 10_080 },
];

const provider = (driver: string, usageLimits: unknown, extra: Record<string, unknown> = {}) => ({ instanceId: driver, driver, enabled: true, installed: true, models: [], auth: { email: `${driver}@example.test` }, usageLimits, ...extra });
const limits = (used = 37, extra: Record<string, unknown> = {}) => ({ checkedAt: FRESH, windows: windows(used), ...extra });

let next = 0;
/** A machine (with its own environment, as the refresh throttle keys by it) whose providers report limits. */
const reporting = (providers: unknown[], extra: Parameters<typeof machine>[0] = {}): GoldenOptions => {
	const environmentId = `limits-${next++}`;
	return {
		machines: [
			machine({
				url: "http://studio:3773",
				environmentId,
				state: { kind: "ready", environmentId, label: "Studio", canOperate: true },
				modelConfig: { providers },
				...extra,
			}),
		],
	};
};

const codex = (used = 37, extra: Record<string, unknown> = {}) => provider("codex", limits(used, extra));
const PROVIDERS = ["orchestration:read", "orchestration:operate", "providers:manage"];

describe("Limits goldens", () => {
	faces("limits", LimitsKey, [
		["none", STATES.none],
		["offline", STATES.offline],
		["no-limits", () => reporting([])],
		["no-limits-provider", () => reporting([provider("codex", undefined)])],
		["unavailable", () => reporting([provider("codex", { checkedAt: FRESH, windows: [], unavailable: { reason: "unsupported" } })])],
		["left", () => reporting([codex()])],
		["used", () => reporting([codex()]), { show: "used" }],
		["weekly", () => reporting([codex()]), { window: "weekly" }],
		["window-by-id", () => reporting([codex()]), { window: "secondary" }],
		["window-missing", () => reporting([codex()]), { window: "monthly" }],
		["full", () => reporting([codex(0)])],
		["empty", () => reporting([codex(100)])],
		["stale", () => reporting([provider("codex", limits(37, { checkedAt: STALE }))])],
		["credits", () => reporting([codex(37, { resetCredits: { availableCount: 2 } })])],
		["credit", () => reporting([codex(37, { resetCredits: { availableCount: 1 } })])],
		["credits-spend", () => reporting([codex(37, { resetCredits: { availableCount: 2 } })]), { resetAction: "spend" }],
		["credits-spend-allowed", () => reporting([codex(37, { resetCredits: { availableCount: 2 } })], { scopes: PROVIDERS }), { resetAction: "spend" }],
		["claude", () => reporting([codex(), provider("claudeAgent", limits(80))]), { provider: "claudeAgent" }],
		["first-of-two", () => reporting([codex(), provider("claudeAgent", limits(80))])],
		["provider-missing", () => reporting([codex()]), { provider: "cursor" }],
		["two-accounts", () => reporting([codex(), provider("codex", limits(50), { instanceId: "codex-work", auth: { email: "work@example.test" } })])],
		["reset-in-days", () => reporting([provider("codex", { checkedAt: FRESH, windows: [{ id: "w", kind: "monthly", label: "Monthly", usedPercent: 10, resetsAt: "2026-06-20T00:00:00Z", windowDurationMins: 43_200 }] })])],
		["reset-passed", () => reporting([provider("codex", { checkedAt: FRESH, windows: [{ id: "w", kind: "session", label: "Session", usedPercent: 10, resetsAt: "2026-06-01T11:00:00Z", windowDurationMins: 300 }] })])],
	]);
	presses("limits", LimitsKey, [
		["tap", () => reporting([codex()])],
		["tap-failure", () => reporting([codex()], { refreshProviders: vi.fn(async () => Promise.reject(new Error("boom"))) })],
		["tap-spend", () => reporting([codex(37, { resetCredits: { availableCount: 2 } })]), { resetAction: "spend" }],
		["hold-open", () => reporting([codex()]), undefined, 600],
		["hold-spend", () => reporting([codex(37, { resetCredits: { availableCount: 2 } })], { scopes: PROVIDERS }), { resetAction: "spend" }, 600],
		["hold-spend-no-access", () => reporting([codex(37, { resetCredits: { availableCount: 2 } })]), { resetAction: "spend" }, 600],
		["hold-spend-none", () => reporting([codex()], { scopes: PROVIDERS }), { resetAction: "spend" }, 600],
		["hold-spend-nothing-to-reset", () => reporting([codex(37, { resetCredits: { availableCount: 1 } })], { scopes: PROVIDERS, consumeResetCredit: vi.fn(async () => ({ outcome: "nothingToReset" })) }), { resetAction: "spend" }, 600],
		["hold-spend-failure", () => reporting([codex(37, { resetCredits: { availableCount: 1 } })], { scopes: PROVIDERS, consumeResetCredit: vi.fn(async () => Promise.reject(new Error("boom"))) }), { resetAction: "spend" }, 600],
		["offline", STATES.offline],
	]);
});
