import { describe, expect, it } from "vitest";

import { continueStep, nextChoice } from "./controls.js";

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

describe("nextChoice", () => {
	const choices = [{ key: "low" }, { key: "high" }];

	it("steps to the next choice and wraps", () => {
		expect(nextChoice({ choices, current: choices[0] })).toBe(choices[1]);
		expect(nextChoice({ choices, current: choices[1] })).toBe(choices[0]);
		expect(nextChoice({ choices, current: undefined })).toBe(choices[0]);
		expect(nextChoice({ choices: [], current: undefined })).toBeUndefined();
	});
});
