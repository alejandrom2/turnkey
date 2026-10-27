import { describe, expect, it } from "vitest";

import { periodInput, SLOW_SCAN_MS, USAGE_REFETCH_MS, type UsageReader, UsageStore, usagePeriod } from "./store.js";
import type { UsageBucket, UsageSummary, UsageSummaryInput } from "./types.js";

const bucket = (costUsd: number): UsageBucket => ({
	day: "2026-10-27",
	provider: "claude",
	model: "opus",
	sourcePath: "/a",
	totals: { uncachedInputTokens: 10, cachedInputTokens: 0, cacheCreationTokens: 0, outputTokens: 5, reasoningTokens: 0 },
	costUsd,
	cacheSavingsUsd: 0,
	costSource: "modelPriced",
	records: 1,
	unpricedRecords: 0,
	sessions: 1,
});

const summary = (costUsd: number, extra: Partial<UsageSummary> = {}): UsageSummary => ({
	contractVersion: 6,
	readAt: "2026-10-27T10:00:00.000Z",
	timeZone: "UTC",
	sinceDay: "2026-10-21",
	untilDay: "2026-10-27",
	buckets: [bucket(costUsd)],
	sources: [{ fingerprint: { hostId: "mac", provider: "claude", resolvedHomePath: "/a", volumeId: "v" }, status: "ok", scannedFiles: 1, skippedFiles: 0, malformedRecords: 0, distinctSessions: 2, message: null }],
	...extra,
});

function reader(answers: ((input: UsageSummaryInput) => Promise<UsageSummary>)[], url = "http://a") {
	const inputs: UsageSummaryInput[] = [];
	const machine: UsageReader & { inputs: UsageSummaryInput[]; usageSettingsStamp: string } = {
		url,
		environmentId: url,
		label: url,
		usageSettingsStamp: "s1",
		inputs,
		usageSummary: (input) => {
			inputs.push(input);
			const answer = answers.shift();
			return answer ? answer(input) : Promise.reject(new Error("no answer"));
		},
	};
	return machine;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("UsageStore", () => {
	it("reads again only after a minute, on a settings change, or when due", async () => {
		let now = 0;
		const store = new UsageStore(() => undefined, () => now);
		const a = reader([async () => summary(1), async () => summary(2), async () => summary(3), async () => summary(4)]);
		store.ensure(a, 7);
		store.ensure(a, 7);
		await settle();
		expect(a.inputs).toHaveLength(1);
		now = 59_999;
		store.ensure(a, 7);
		expect(store.due(a, 7)).toBe(false);
		now = 60_000;
		store.ensure(a, 7);
		await settle();
		expect(a.inputs).toHaveLength(2);
		a.usageSettingsStamp = "s2";
		expect(store.due(a, 7)).toBe(true);
		store.ensure(a, 7, Number.POSITIVE_INFINITY);
		await settle();
		expect(a.inputs).toHaveLength(3);
		now += USAGE_REFETCH_MS;
		expect(store.due(a, 7)).toBe(true);
		expect(store.view([a], 7).merged?.costUsd).toBe(3);
	});

	it("reads slow scans half as often", async () => {
		let now = 0;
		const store = new UsageStore(() => undefined, () => now);
		const a = reader([async () => summary(1, { scanDurationMs: SLOW_SCAN_MS + 1 })]);
		await store.refresh(a, 30);
		now = USAGE_REFETCH_MS;
		expect(store.due(a, 30)).toBe(false);
		now = 2 * USAGE_REFETCH_MS;
		expect(store.due(a, 30)).toBe(true);
	});

	it("shows a cached answer, then the full one, keeping the first if the second fails", async () => {
		const store = new UsageStore(() => undefined);
		const refreshing = summary(1, { sources: [{ ...summary(0).sources[0]!, refreshing: true }] });
		let release!: (value: UsageSummary) => void;
		const a = reader([async () => refreshing, () => new Promise((resolve) => (release = resolve))]);
		const read = store.refresh(a, 7);
		await settle();
		expect(store.view([a], 7)).toMatchObject({ merged: { costUsd: 1 }, loading: true });
		expect(a.inputs[1]).toMatchObject({ awaitRefresh: true });
		release(summary(5));
		await read;
		expect(store.view([a], 7)).toMatchObject({ merged: { costUsd: 5 }, loading: false });

		const b = reader([async () => refreshing, async () => Promise.reject(new Error("cursor down"))], "http://b");
		await store.refresh(b, 7);
		expect(store.view([b], 7)).toMatchObject({ merged: { costUsd: 1 }, loading: false });
	});

	it("merges machines that answered and reports the failure when none did", async () => {
		const store = new UsageStore(() => undefined);
		const a = reader([async () => summary(1)]);
		const b = reader([async () => Promise.reject(new Error("denied"))], "http://b");
		await Promise.all([store.refresh(a, 7), store.refresh(b, 7)]);
		expect(store.view([a, b], 7).merged).toMatchObject({ costUsd: 1, sessions: 2 });
		expect(store.view([b], 7)).toMatchObject({ loading: false, error: new Error("denied") });
	});

	it("asks for the past day by the hour and other periods by calendar day", () => {
		const now = new Date("2026-10-27T10:42:30.000Z");
		expect(periodInput(1, now)).toMatchObject({ resolution: "hour", untilTime: "2026-10-27T10:42:00.000Z" });
		expect(periodInput(7, now)).toMatchObject({ resolution: "day" });
		expect([usagePeriod("7"), usagePeriod(90), usagePeriod("month"), usagePeriod(undefined)]).toEqual([7, 90, 30, 30]);
	});
});

describe("UsageStore edges", () => {
	it("reads again after a running read when asked to, so new prices land", async () => {
		const store = new UsageStore(() => undefined);
		let release!: (value: UsageSummary) => void;
		const a = reader([() => new Promise((resolve) => (release = resolve)), async () => summary(9)]);
		const first = store.refresh(a, 7);
		const after = store.refresh(a, 7, true);
		await settle();
		expect(a.inputs).toHaveLength(1);
		release(summary(1));
		await first;
		await after;
		expect(a.inputs).toHaveLength(2);
		expect(store.view([a], 7).merged?.costUsd).toBe(9);
	});

	it("says who must update when no answer has a contract it can merge", async () => {
		const store = new UsageStore(() => undefined);
		const newer = reader([async () => summary(1, { contractVersion: 7 })]);
		const older = reader([async () => summary(1, { contractVersion: 3 })], "http://old");
		await Promise.all([store.refresh(newer, 7), store.refresh(older, 7)]);
		expect(store.view([newer], 7)).toEqual({ loading: false, mismatch: "clientBehind" });
		expect(store.view([older], 7)).toEqual({ loading: false, mismatch: "serverBehind" });
	});
});
