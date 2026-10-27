import { describe, expect, it } from "vitest";

import { mergeUsage } from "./merge.js";
import type { UsageBucket } from "./types.js";
import { periodLabel, usageDriver, usageItems } from "./usageView.js";

const bucket = (overrides: Partial<UsageBucket>): UsageBucket => ({
	day: "2026-10-26",
	provider: "claude",
	model: "claude-opus",
	sourcePath: "/claude",
	totals: { uncachedInputTokens: 182_340, cachedInputTokens: 48_211_903, cacheCreationTokens: 2_310_442, outputTokens: 412_087, reasoningTokens: 0 },
	costUsd: 46.88,
	cacheSavingsUsd: 0,
	costSource: "modelPriced",
	records: 10,
	unpricedRecords: 0,
	sessions: 4,
	...overrides,
});

describe("usage items", () => {
	it("lists the total, then models by cost, in T3 Code's figures", () => {
		const merged = mergeUsage(
			[
				{
					environmentId: "env",
					label: "Studio",
					summary: {
						contractVersion: 6,
						readAt: "2026-10-27T10:00:00.000Z",
						timeZone: "UTC",
						sinceDay: "2026-10-21",
						untilDay: "2026-10-27",
						buckets: [
							bucket({}),
							bucket({ provider: "opencode", model: "preview", sourcePath: "/oc", costUsd: 0, costSource: "unpriced", unpricedRecords: 10, totals: { uncachedInputTokens: 90_000, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 12_000, reasoningTokens: 0 } }),
						],
						sources: [
							{ fingerprint: { hostId: "mac", provider: "claude", resolvedHomePath: "/claude", volumeId: "v" }, status: "ok", scannedFiles: 1, skippedFiles: 0, malformedRecords: 0, distinctSessions: 96, message: null },
							{ fingerprint: { hostId: "mac", provider: "opencode", resolvedHomePath: "/oc", volumeId: "v" }, status: "ok", scannedFiles: 1, skippedFiles: 0, malformedRecords: 0, distinctSessions: 2, message: null },
						],
					},
				},
			],
			6,
		);
		const [total, opus, preview] = usageItems(merged);
		expect(total).toMatchObject({ label: "All models", cost: "$46.88", tokens: "51.2M tokens", detail: "98 sessions" });
		expect(total!.share).toBeUndefined();
		expect(opus).toMatchObject({ label: "claude-opus", provider: "claude", cost: "$46.88", share: 1, tokens: "51.1M tokens", detail: "95.1% cache · $0.92/M" });
		expect(preview).toMatchObject({ cost: "Unpriced", detail: "0.0% cache" });
		expect(preview!.share).toBeUndefined();
	});

	it("names periods and drivers as T3 Code does", () => {
		expect([1, 7, 30, 90].map((period) => periodLabel(period as 1))).toEqual(["Past 24h", "7 days", "30 days", "90 days"]);
		expect([usageDriver("claude"), usageDriver("codex")]).toEqual(["claudeAgent", "codex"]);
	});
});
