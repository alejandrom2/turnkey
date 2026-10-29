import { describe, it, vi } from "vitest";

import { USAGE_CONTRACT_VERSION, type UsageBucket } from "../core/usage/types.js";
import { UsageKey } from "./usage.js";
import { type GoldenOptions, recordFace, recordPress } from "./testing/harness.js";
import { machine, STATES } from "./testing/fixtures.js";

vi.mock("@elgato/streamdeck", async () => await import("./testing/streamdeck.js"));
vi.mock("node:child_process", async () => await import("./testing/process.js"));
vi.mock("../deck.js", async () => await import("./testing/deck.js"));
// The store's windows follow the clock and the time zone: the key hands them to the machine, so a record names them.
vi.hoisted(() => void (process.env.TZ = "UTC"));
vi.mock("../core/usage/store.js", async (original) => {
	const module = await original<typeof import("../core/usage/store.js")>();
	class UsageStore extends module.UsageStore {
		constructor(onChange: () => void, _now: () => number, onScan: ConstructorParameters<typeof module.UsageStore>[2]) {
			super(onChange, () => Date.now(), onScan);
		}
	}
	return { ...module, UsageStore };
});

// Recorded from today's keys so the shared-keys refactor can prove no Stream Deck key changed. Never update these to make
// a refactor pass: a changed golden is a bug.

type Setup = [name: string, make: () => GoldenOptions, settings?: Record<string, unknown>, held?: number | number[]];

const faces = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings] of setups) it(`${key} face: ${name}`, () => recordFace(`${key}-${name}`, Class, { ...make(), settings }));
};
const presses = (key: string, Class: new () => object, setups: Setup[]) => {
	for (const [name, make, settings, held] of setups) it(`${key} press: ${name}`, () => recordPress(`${key}-press-${name}`, Class, { ...make(), settings }, held ?? 0));
};

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

const source = (provider: "codex" | "claude", extra: Record<string, unknown> = {}) => ({
	fingerprint: { hostId: "studio", provider, resolvedHomePath: `/home/${provider}`, volumeId: "vol" },
	status: "ok",
	scannedFiles: 4,
	skippedFiles: 0,
	malformedRecords: 0,
	distinctSessions: 4,
	message: null,
	...extra,
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

const DIAGNOSTICS = ["orchestration:read", "orchestration:operate", "diagnostics:read"];
const reading = (usageSummary: unknown, extra: Parameters<typeof machine>[0] = {}): GoldenOptions => ({
	machines: [
		machine({
			url: `http://usage-${next++}:3773`,
			scopes: DIAGNOSTICS,
			modelConfig: { providers: [{ instanceId: "codex", driver: "codex", models: [] }, { instanceId: "claudeAgent", driver: "claudeAgent", models: [] }] },
			usageSummary: typeof usageSummary === "function" ? vi.fn(usageSummary as () => Promise<unknown>) : vi.fn(async () => usageSummary),
			...extra,
		}),
	],
});
let next = 0;

describe("Usage goldens", () => {
	faces("usage", UsageKey, [
		["none", STATES.none],
		["offline", STATES.offline],
		["no-access", () => ({ machines: [machine({ url: `http://usage-${next++}:3773` })] })],
		["loading", () => reading(() => new Promise(() => undefined))],
		["failed", () => reading(async () => Promise.reject(new Error("boom")))],
		["month", () => reading(summary())],
		["day", () => reading(summary()), { period: "1" }],
		["week", () => reading(summary()), { period: "7" }],
		["quarter", () => reading(summary()), { period: "90" }],
		["provider-claude", () => reading(summary()), { provider: "claude" }],
		["provider-codex", () => reading(summary()), { provider: "codex" }],
		["provider-absent", () => reading(summary([bucket()])), { provider: "claude" }],
		["empty", () => reading(summary([]))],
		["unpriced", () => reading(summary([bucket({ costSource: "unpriced", costUsd: 0, unpricedRecords: 40 })]))],
		["refreshing", () => reading(summary(undefined, { sources: [source("codex", { refreshing: true })] }))],
		["server-behind", () => reading(summary(undefined, { contractVersion: 1 }))],
		["client-behind", () => reading(summary(undefined, { contractVersion: USAGE_CONTRACT_VERSION + 5 }))],
		["small", () => reading(summary([bucket({ costUsd: 0.04 })]))],
		["large", () => reading(summary([bucket({ costUsd: 1234.5 })]))],
		["two-machines", () => ({ machines: [...reading(summary([bucket()])).machines!, ...reading(summary([bucket({ provider: "claude", model: "opus", costUsd: 30 })])).machines!] })],
	]);
	presses("usage", UsageKey, [
		["tap", () => reading(summary())],
		["long", () => reading(summary()), undefined, 600],
		["period", () => reading(summary()), { period: "7" }],
		["no-access", () => ({ machines: [machine({ url: `http://usage-${next++}:3773` })] })],
		["failed", () => reading(async () => Promise.reject(new Error("boom")))],
		["offline", STATES.offline],
	]);
});
