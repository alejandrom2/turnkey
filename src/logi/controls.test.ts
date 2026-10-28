import { describe, expect, it } from "vitest";

import { continueStep, stepWithin } from "./controls.js";

describe("continueStep", () => {
	it("opens a thread that waits on you, so you decide in T3 Code", () => {
		expect(continueStep({ deck: "approval" })).toBe("open");
		expect(continueStep({ deck: "question" })).toBe("open");
	});

	it("nudges a thread that stopped, finished or sits idle", () => {
		for (const deck of ["stopped", "done", "failed", "idle"] as const) expect(continueStep({ deck }), deck).toBe("send");
	});

	it("leaves a busy thread alone, and does nothing without one", () => {
		expect(continueStep({ deck: "running" })).toBeUndefined();
		expect(continueStep({ deck: "queued" })).toBeUndefined();
		expect(continueStep(undefined)).toBeUndefined();
	});
});

describe("stepWithin", () => {
	const levels = ["low", "medium", "high"] as const;

	it("moves by the scroll's ticks and stops at the ends", () => {
		expect(stepWithin(levels, "low", 1)).toBe("medium");
		expect(stepWithin(levels, "low", 5)).toBe("high");
		expect(stepWithin(levels, "medium", -3)).toBe("low");
	});

	it("is undefined when nothing would change", () => {
		expect(stepWithin(levels, "high", 2)).toBeUndefined();
		expect(stepWithin(levels, "low", 0)).toBeUndefined();
		expect(stepWithin([], "low", 1)).toBeUndefined();
	});

	it("starts from the first level when the current one isn't listed", () => {
		expect(stepWithin(levels, undefined, 1)).toBe("medium");
		expect(stepWithin(levels, "max", -1)).toBe("low");
	});
});
