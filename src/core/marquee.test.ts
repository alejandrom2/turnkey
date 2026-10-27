import { describe, expect, it, vi } from "vitest";

import { MARQUEE, Marquee, marqueeFrame } from "./marquee.js";

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
