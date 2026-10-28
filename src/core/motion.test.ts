import { describe, expect, it, vi } from "vitest";

import { Animator, flashWash, MOTION, motionMode, nextMinute, pulseWash, spinAngle, threadMotion, Transitions, twinkleStep } from "./motion.js";

describe("motion frames", () => {
	it("defaults to Full", () => {
		expect([motionMode(undefined), motionMode("reduced"), motionMode("off"), motionMode("nope")]).toEqual(["full", "reduced", "off", "full"]);
	});

	it("spins in 30° steps at 10 fps in Full, a third as fast in Reduced, and not at all when Off", () => {
		expect(spinAngle("full", 0)).toBe(0);
		expect(spinAngle("full", 100)).toBe(30);
		expect(spinAngle("full", 1_200)).toBe(0);
		expect(spinAngle("reduced", 100)).toBe(0);
		expect(spinAngle("reduced", 250)).toBe(30);
		expect(spinAngle("off", 12_345)).toBe(0);
	});

	it("pulses only in Full, between a faint and a clear wash", () => {
		const washes = Array.from({ length: MOTION.pulseFrames }, (_, frame) => pulseWash("full", frame * MOTION.frameMs.full)!);
		expect(Math.min(...washes)).toBeCloseTo(0.08);
		expect(Math.max(...washes)).toBeCloseTo(0.32);
		expect(pulseWash("reduced", 500)).toBeUndefined();
		expect(pulseWash("off", 500)).toBeUndefined();
	});

	it("flashes once, settling for 1.3 s", () => {
		expect(flashWash(0)).toBe(0.5);
		expect(flashWash(650)!).toBeLessThan(0.5);
		expect(flashWash(MOTION.flashMs)).toBeUndefined();
	});
});

describe("Transitions", () => {
	it("flashes a thread that finishes or fails while watched, never one seen for the first time", () => {
		let now = 0;
		const transitions = new Transitions(() => now);
		transitions.update([{ key: "a", deck: "done" }, { key: "b", deck: "running" }]);
		expect(transitions.age("a")).toBeUndefined();
		now = 100;
		transitions.update([{ key: "a", deck: "done" }, { key: "b", deck: "failed" }]);
		now = 400;
		expect(transitions.age("b")).toBe(300);
		now = 100 + MOTION.flashMs;
		expect(transitions.age("b")).toBeUndefined();
	});

	it("forgets threads that leave, so a reconnect doesn't flash them", () => {
		let now = 0;
		const transitions = new Transitions(() => now);
		transitions.update([{ key: "a", deck: "running" }]);
		transitions.update([]);
		now = 50;
		transitions.update([{ key: "a", deck: "done" }]);
		expect(transitions.age("a")).toBeUndefined();
	});
});

describe("Transitions changes", () => {
	it("reports what changed since the last look", () => {
		const transitions = new Transitions(() => 0);
		expect(transitions.update([{ key: "a", deck: "running" }])).toEqual([]);
		expect(transitions.update([{ key: "a", deck: "done" }])).toEqual([{ key: "a", from: "running", to: "done" }]);
		transitions.update([]);
		expect(transitions.update([{ key: "a", deck: "failed" }])).toEqual([]);
	});
});

describe("threadMotion", () => {
	const none = { age: () => undefined };

	it("spins running threads and pulses waiting ones in Full", () => {
		expect(threadMotion("full", { key: "a", deck: "running" }, none, 100)).toEqual({ motion: { spin: 30 }, moving: true });
		expect(threadMotion("full", { key: "a", deck: "approval" }, none, 0).moving).toBe(true);
		expect(threadMotion("full", { key: "a", deck: "idle" }, none, 0)).toEqual({ motion: {}, moving: false });
	});

	it("keeps waiting threads still in Reduced, and everything still when Off", () => {
		expect(threadMotion("reduced", { key: "a", deck: "question" }, none, 0)).toEqual({ motion: {}, moving: false });
		expect(threadMotion("reduced", { key: "a", deck: "done" }, { age: () => 100 }, 0).moving).toBe(true);
		expect(threadMotion("off", { key: "a", deck: "running" }, { age: () => 100 }, 0)).toEqual({ motion: {}, moving: false });
	});
});

describe("Animator", () => {
	function setup() {
		let now = 0;
		const timers: { run: () => void; at: number; id: number }[] = [];
		let next = 0;
		const animator = new Animator(
			() => now,
			{
				set: (run, ms) => {
					timers.push({ run, at: now + ms, id: ++next });
					return next;
				},
				clear: (id) => timers.splice(timers.findIndex((timer) => timer.id === id), 1),
			},
		);
		const advance = () => {
			const timer = timers.sort((a, b) => a.at - b.at).shift()!;
			now = timer.at;
			timer.run();
		};
		return { animator, timers, advance, now: () => now };
	}

	it("runs one timer on frame boundaries only while something moves", () => {
		const { animator, timers, advance, now } = setup();
		const frame = vi.fn();
		animator.set("a", frame);
		animator.set("b", frame);
		expect(timers).toHaveLength(1);
		advance();
		expect(now()).toBe(100);
		expect(frame).toHaveBeenCalledTimes(2);
		animator.set("a", undefined);
		animator.set("b", undefined);
		expect(timers).toHaveLength(0);
	});

	it("slows to Reduced frames and stops when Off", () => {
		const { animator, timers, advance, now } = setup();
		animator.mode = "reduced";
		animator.set("a", () => undefined);
		advance();
		expect(now()).toBe(250);
		animator.mode = "off";
		expect(timers).toHaveLength(0);
	});
});

describe("nextMinute", () => {
	it("waits for the soonest running turn's next minute", () => {
		expect(nextMinute([], 0)).toBeUndefined();
		expect(nextMinute([0, 30_000], 50_000)).toBe(10_000);
		expect(nextMinute([1_000], 61_000)).toBe(60_000);
	});
});

describe("twinkleStep", () => {
	it("steps every other frame, slower when Reduced, and not at all when Off", () => {
		expect(twinkleStep("off", 10_000)).toBeUndefined();
		expect([twinkleStep("full", 0), twinkleStep("full", 199), twinkleStep("full", 200)]).toEqual([0, 0, 1]);
		expect([twinkleStep("reduced", 499), twinkleStep("reduced", 500)]).toEqual([0, 1]);
	});
});
