import { describe, expect, it, vi } from "vitest";

import { MARQUEE, Marquee, marqueeFrame, ROLL, rollFrame } from "./marquee.js";

const forwardMs = (overflow: number) => (overflow / MARQUEE.pxPerSecond) * 1000;
const backMs = (overflow: number) => (overflow / MARQUEE.returnPxPerSecond) * 1000;

describe("marqueeFrame", () => {
	it("does nothing for text that fits", () => {
		expect(marqueeFrame(0, 0)).toEqual({ offset: 0, next: undefined });
	});

	it("slides at a reading pace, at most ten frames a second", () => {
		expect(marqueeFrame(0, 80)).toEqual({ offset: 0, next: MARQUEE.frameMs });
		expect(marqueeFrame(1000, 80)).toEqual({ offset: MARQUEE.pxPerSecond, next: MARQUEE.frameMs });
		expect(marqueeFrame(1950, 80)).toEqual({ offset: 78, next: 50 });
	});

	it("rests at the end with one frame due when the pause ends, then slides back faster", () => {
		const end = forwardMs(80);
		expect(marqueeFrame(end, 80)).toEqual({ offset: 80, next: MARQUEE.pauseMs });
		const back = end + MARQUEE.pauseMs;
		expect(marqueeFrame(back, 80).offset).toBe(80);
		expect(marqueeFrame(back + backMs(80) / 2, 80).offset).toBe(40);
	});

	it("rests at the start between loops and stops after the second loop", () => {
		const loop = forwardMs(80) + MARQUEE.pauseMs + backMs(80);
		expect(marqueeFrame(loop, 80)).toEqual({ offset: 0, next: MARQUEE.pauseMs });
		expect(marqueeFrame(loop + MARQUEE.pauseMs + 1000, 80).offset).toBe(40);
		const total = MARQUEE.loops * loop + (MARQUEE.loops - 1) * MARQUEE.pauseMs;
		expect(marqueeFrame(total - 1, 80).next).toBeDefined();
		expect(marqueeFrame(total, 80)).toEqual({ offset: 0, next: undefined });
	});
});

describe("Marquee", () => {
	function setup(overflow = 80) {
		const painted: string[] = [];
		const marquee = new Marquee((owner) => painted.push(`${owner}@${marquee.offset(owner, { key: "t", overflow })}`));
		return { marquee, painted };
	}

	it("waits a second after the last interaction, then scrolls a bounded number of frames and goes quiet", () => {
		vi.useFakeTimers();
		try {
			const { marquee, painted } = setup();
			marquee.interact("a");
			expect(marquee.offset("a", { key: "t", overflow: 80 })).toBe(0);
			vi.advanceTimersByTime(MARQUEE.delayMs - 1);
			marquee.interact("a");
			vi.advanceTimersByTime(MARQUEE.delayMs - 1);
			expect(painted).toEqual([]);
			vi.advanceTimersByTime(1 + 60_000);
			expect(marquee.moving).toBe(false);
			expect(painted.at(-1)).toBe("a@0");
			const frames = painted.length;
			const loop = forwardMs(80) + backMs(80);
			expect(frames).toBeLessThanOrEqual(Math.ceil((MARQUEE.loops * loop) / MARQUEE.frameMs) + 2 * MARQUEE.loops + 1);
			vi.advanceTimersByTime(60_000);
			expect(painted).toHaveLength(frames);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("never scrolls text that fits", () => {
		vi.useFakeTimers();
		try {
			const { marquee, painted } = setup(0);
			marquee.interact("a");
			marquee.offset("a", undefined);
			vi.advanceTimersByTime(10_000);
			expect(painted).toEqual([]);
		} finally {
			vi.useRealTimers();
		}
	});

	it("only the dial in use scrolls: touching another stops and repaints the first at rest", () => {
		vi.useFakeTimers();
		try {
			const { marquee, painted } = setup();
			marquee.interact("a");
			marquee.offset("a", { key: "t", overflow: 80 });
			vi.advanceTimersByTime(MARQUEE.delayMs + 500);
			expect(marquee.offset("a", { key: "t", overflow: 80 })).toBeGreaterThan(0);
			marquee.interact("b");
			expect(painted.at(-1)).toBe("a@0");
			expect(marquee.offset("a", { key: "t", overflow: 80 })).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("stops when the scrolling text changes", () => {
		vi.useFakeTimers();
		try {
			const { marquee } = setup();
			marquee.interact("a");
			marquee.offset("a", { key: "t", overflow: 80 });
			vi.advanceTimersByTime(MARQUEE.delayMs + 500);
			expect(marquee.moving).toBe(true);
			expect(marquee.offset("a", { key: "other", overflow: 80 })).toBe(0);
			expect(marquee.moving).toBe(false);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("puts a scroll cut short by another touch of the same dial back at the start at once", () => {
		vi.useFakeTimers();
		try {
			const { marquee, painted } = setup();
			marquee.interact("a");
			marquee.offset("a", { key: "t", overflow: 80 });
			vi.advanceTimersByTime(MARQUEE.delayMs + 500);
			expect(painted.at(-1)).not.toBe("a@0");
			marquee.interact("a");
			expect(painted.at(-1)).toBe("a@0");
		} finally {
			vi.useRealTimers();
		}
	});
});

describe("rollFrame", () => {
	it("does nothing for a single line", () => {
		expect(rollFrame(0, 1, 20)).toEqual({ offset: 0, next: undefined });
	});

	it("rolls up a line at a time at up to 15 frames a second, resting on each line", () => {
		const moving = rollFrame(ROLL.rollMs / 2, 3, 20);
		expect(moving.offset).toBe(10);
		expect(moving.next).toBeLessThanOrEqual(ROLL.frameMs);
		expect(rollFrame(ROLL.rollMs, 3, 20)).toEqual({ offset: 20, next: ROLL.lineMs });
		expect(rollFrame(ROLL.rollMs + ROLL.lineMs + ROLL.rollMs, 3, 20).offset).toBe(40);
	});

	it("comes back round to the first line and stops after two passes, in a bounded number of frames", () => {
		const step = ROLL.rollMs + ROLL.lineMs;
		expect(rollFrame(3 * step - ROLL.lineMs, 3, 20)).toEqual({ offset: 0, next: ROLL.lineMs });
		let elapsed = 0;
		let frames = 0;
		for (let frame = rollFrame(0, 3, 20); frame.next !== undefined; frame = rollFrame(elapsed, 3, 20)) {
			elapsed += frame.next;
			frames++;
		}
		expect(elapsed).toBe(ROLL.passes * 3 * step - ROLL.lineMs);
		expect(frames).toBeLessThanOrEqual(ROLL.passes * 3 * (Math.ceil(ROLL.rollMs / ROLL.frameMs) + 1));
		expect(rollFrame(elapsed, 3, 20)).toEqual({ offset: 0, next: undefined });
	});
});

describe("Marquee rolling a line", () => {
	it("rolls after the delay, then rests on the first line with no timers left", () => {
		vi.useFakeTimers();
		try {
			const line = { key: "v", overflow: 40, roll: { lines: ["one", "two"], height: 20 } };
			const offsets: number[] = [];
			const marquee: Marquee = new Marquee((owner) => offsets.push(marquee.offset(owner, line)));
			marquee.interact("a");
			marquee.offset("a", line);
			vi.advanceTimersByTime(MARQUEE.delayMs + ROLL.rollMs);
			expect(offsets.at(-1)).toBe(20);
			vi.advanceTimersByTime(60_000);
			expect(offsets.at(-1)).toBe(0);
			expect(marquee.moving).toBe(false);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
