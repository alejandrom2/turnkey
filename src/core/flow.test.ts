import { describe, expect, it } from "vitest";

import { dialGroups, dialRuns, flowArt } from "./flow.js";

describe("dialRuns", () => {
	it("groups adjacent dial columns per device, and a gap breaks a run", () => {
		const runs = dialRuns([
			{ id: "a", device: "d", column: 0 },
			{ id: "b", device: "d", column: 1 },
			{ id: "c", device: "d", column: 3 },
			{ id: "e", device: "other", column: 2 },
		]);
		expect(runs.get("a")).toEqual({ length: 2, position: 0 });
		expect(runs.get("b")).toEqual({ length: 2, position: 1 });
		expect(runs.get("c")).toEqual({ length: 1, position: 0 });
		expect(runs.get("e")).toEqual({ length: 1, position: 0 });
	});
});

describe("dialGroups", () => {
	it("lists each run's dial ids left to right, whatever order they were placed in", () => {
		const groups = dialGroups([
			{ id: "c", device: "d", column: 2 },
			{ id: "a", device: "d", column: 0 },
			{ id: "e", device: "other", column: 1 },
			{ id: "b", device: "d", column: 1 },
			{ id: "f", device: "d", column: 4 },
		]);
		expect(groups).toEqual([["a", "b", "c"], ["f"], ["e"]]);
	});
});

describe("flowArt", () => {
	it("draws one picture as wide as the run and shifts it to the dial's slice", () => {
		const art = flowArt({ length: 4, position: 2 });
		expect(art).toContain(`width="800"`);
		expect(art).toContain("translate(-400 0)");
		expect(flowArt({ length: 4, position: 0 }).replace("translate(0 0)", "")).toBe(art.replace("translate(-400 0)", ""));
	});
});
