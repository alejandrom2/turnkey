import { describe, expect, it } from "vitest";

import { forkSourceRun, latestMergeBackRun, mergeBackTarget } from "./lineage.js";

describe("mergeBackTarget", () => {
	it("merges a fork into the thread its run came from, else its parent; other threads have nowhere to go", () => {
		const fork = { parentThreadId: "parent", relationshipToParent: "fork" };
		expect(mergeBackTarget({ lineage: fork, forkedFrom: { type: "run", threadId: "source" } })).toBe("source");
		expect(mergeBackTarget({ lineage: fork, forkedFrom: { type: "node" } })).toBe("parent");
		expect(mergeBackTarget({ lineage: fork, forkedFrom: null })).toBe("parent");
		expect(mergeBackTarget({ lineage: { parentThreadId: "parent", relationshipToParent: "subagent" } })).toBeUndefined();
		expect(mergeBackTarget({})).toBeUndefined();
	});
});

describe("latestMergeBackRun (T3 Code's resolveLatestMergeBackRun cases)", () => {
	it("merges the newest provider-finished run while checkpoint capture is pending", () => {
		const runs = [
			{ id: "newest-queued", status: "queued", ordinal: 3 },
			{ id: "older-completed", status: "completed", ordinal: 1 },
			{ id: "newest-finished", status: "waiting", ordinal: 2 },
		];
		expect(latestMergeBackRun(runs)?.id).toBe("newest-finished");
	});

	it.each(["preparing", "starting", "running"])("does not merge older history while a newer run is %s", (status) => {
		expect(latestMergeBackRun([{ id: "older-completed", status: "completed", ordinal: 1 }, { id: "newer-active", status, ordinal: 2 }])).toBeUndefined();
	});

	it("has nothing to merge before a turn finishes", () => {
		expect(latestMergeBackRun([{ id: "failed", status: "failed", ordinal: 1 }])).toBeUndefined();
	});
});

describe("forkSourceRun", () => {
	it("forks from the newest run that ended, as the server allows, skipping one still under way", () => {
		const runs = [
			{ id: "first", status: "completed", ordinal: 1 },
			{ id: "stopped", status: "interrupted", ordinal: 2 },
			{ id: "running", status: "running", ordinal: 3 },
		];
		expect(forkSourceRun(runs)?.id).toBe("stopped");
		expect(forkSourceRun([{ id: "queued", status: "queued", ordinal: 1 }])).toBeUndefined();
	});
});
