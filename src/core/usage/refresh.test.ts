import { describe, expect, it } from "vitest";

import { LIMITS_REFRESH_GAP_MS, LimitsRefresher, refreshLimits } from "./refresh.js";

const deferred = () => {
	let resolve!: (value: string) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<string>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

describe("LimitsRefresher", () => {
	it("skips automatic refreshes for five minutes after one ends, even a failed one", async () => {
		let now = 0;
		const refresher = new LimitsRefresher(() => now);
		let calls = 0;
		await expect(refresher.refresh("env", async () => (calls++, Promise.reject(new Error("down"))), true)).rejects.toThrow("down");
		expect(await refresher.refresh("env", async () => (calls++, "again"), true)).toBeUndefined();
		now = LIMITS_REFRESH_GAP_MS - 1;
		expect(await refresher.refresh("env", async () => (calls++, "again"), true)).toBeUndefined();
		expect(await refresher.refresh("other", async () => (calls++, "other"), true)).toBe("other");
		now = LIMITS_REFRESH_GAP_MS;
		expect(await refresher.refresh("env", async () => (calls++, "later"), true)).toBe("later");
		expect(calls).toBe(3);
	});

	it("runs a manual refresh inside the gap, and shares one in flight", async () => {
		const refresher = new LimitsRefresher(() => 0);
		await refresher.refresh("env", async () => "first");
		const gate = deferred();
		const manual = refresher.refresh("env", () => gate.promise);
		expect(refresher.pending("env")).toBe(true);
		const joined = refresher.refresh("env", async () => "never");
		const automatic = refresher.refresh("env", async () => "never", true);
		gate.resolve("manual");
		expect(await manual).toBe("manual");
		expect(await joined).toBe("manual");
		expect(await automatic).toBeUndefined();
	});

	it("runs again after the one in flight when asked to", async () => {
		const refresher = new LimitsRefresher(() => 0);
		const gate = deferred();
		const first = refresher.refresh("env", () => gate.promise);
		const after = refresher.refresh("env", async () => "second", false, true);
		gate.reject(new Error("first failed"));
		await expect(first).rejects.toThrow("first failed");
		expect(await after).toBe("second");
	});
});

describe("refreshLimits", () => {
	it("does nothing for a machine with no environment", async () => {
		let calls = 0;
		await refreshLimits(new LimitsRefresher(), { environmentId: undefined, refreshProviders: async () => void calls++ } as never, false);
		expect(calls).toBe(0);
	});

	it("refreshes the providers once for a machine with an environment", async () => {
		let calls = 0;
		await refreshLimits(new LimitsRefresher(), { environmentId: "env", refreshProviders: async () => void calls++ }, false);
		expect(calls).toBe(1);
	});
});
