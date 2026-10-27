import { describe, expect, it, vi } from "vitest";

import { SLIDE, slideFrame, Slides } from "./slides.js";

describe("slideFrame", () => {
	it("eases from 0 to 1 within the duration, at most 15 frames a second, then stops", () => {
		let elapsed = 0;
		const progress: number[] = [];
		for (;;) {
			const frame = slideFrame(elapsed);
			progress.push(frame.progress);
			if (frame.next === undefined) break;
			expect(frame.next).toBeLessThanOrEqual(SLIDE.frameMs);
			elapsed += frame.next;
		}
		expect(progress.length).toBeLessThanOrEqual(Math.ceil(SLIDE.durationMs / SLIDE.frameMs) + 1);
		expect(progress.at(-1)).toBe(1);
		expect(progress).toEqual([...progress].sort((a, b) => a - b));
	});
});

describe("Slides", () => {
	const at = (index: number, count = 10, wrap = false) => ({ index, key: `k${index % count}`, count, wrap });

	function setup() {
		vi.useFakeTimers();
		const frames: number[] = [];
		const targets = new Map<string, ReturnType<typeof at>>();
		const slides: Slides = new Slides((owner) => frames.push(slides.position(owner, targets.get(owner)!)), () => Date.now());
		const paint = (owner: string, target: ReturnType<typeof at>) => {
			targets.set(owner, target);
			return slides.position(owner, target);
		};
		return { slides, frames, paint, [Symbol.dispose]: () => void vi.useRealTimers() };
	}

	it("slides one turn after a short pause, in a bounded number of frames, then goes quiet", () => {
		using test = setup();
		test.paint("a", at(0));
		test.slides.turn("a");
		expect(test.paint("a", at(1))).toBe(0);
		vi.advanceTimersByTime(SLIDE.debounceMs - 1);
		expect(test.frames).toEqual([]);
		vi.advanceTimersByTime(1 + SLIDE.durationMs + SLIDE.frameMs);
		expect(test.frames.at(-1)).toBe(1);
		expect(test.frames.length).toBeLessThanOrEqual(Math.ceil(SLIDE.durationMs / SLIDE.frameMs) + 1);
		expect(test.slides.moving).toBe(false);
		vi.advanceTimersByTime(10_000);
		expect(test.frames.at(-1)).toBe(1);
	});

	it("coalesces a fast spin into one slide that starts one item short of where it ends", () => {
		using test = setup();
		test.paint("a", at(0));
		for (let index = 1; index <= 6; index++) {
			test.slides.turn("a");
			test.paint("a", at(index));
			vi.advanceTimersByTime(20);
		}
		expect(test.frames).toEqual([]);
		vi.advanceTimersByTime(SLIDE.debounceMs);
		expect(test.frames[0]).toBe(5);
		vi.advanceTimersByTime(SLIDE.durationMs);
		expect(test.frames.at(-1)).toBe(6);
		expect(test.frames.every((position) => position >= 5 && position <= 6)).toBe(true);
	});

	it("retargets a slide in progress at once, from no more than one item away", () => {
		using test = setup();
		test.paint("a", at(0));
		test.slides.turn("a");
		test.paint("a", at(1));
		vi.advanceTimersByTime(SLIDE.debounceMs + SLIDE.frameMs);
		const midway = test.frames.at(-1)!;
		expect(midway).toBeGreaterThan(0);
		expect(midway).toBeLessThan(1);
		test.slides.turn("a");
		expect(test.paint("a", at(2))).toBe(1);
		vi.advanceTimersByTime(SLIDE.durationMs);
		expect(test.frames.at(-1)).toBe(2);
	});

	it("comes round a cycling list the short way", () => {
		using test = setup();
		test.paint("a", at(4, 5, true));
		test.slides.turn("a");
		test.paint("a", { ...at(0, 5, true), key: "k0" });
		vi.advanceTimersByTime(SLIDE.debounceMs + SLIDE.durationMs);
		expect(test.frames.at(-1)).toBe(5);
		expect(test.frames.every((position) => position >= 4 && position <= 5)).toBe(true);
	});

	it("snaps when the item changes without a turn, and only the dial last turned moves", () => {
		using test = setup();
		test.paint("a", at(0));
		test.paint("b", at(0));
		expect(test.paint("a", at(3))).toBe(3);
		test.slides.turn("b");
		test.paint("b", at(1));
		test.slides.turn("a");
		vi.advanceTimersByTime(SLIDE.debounceMs + SLIDE.durationMs);
		expect(test.paint("b", at(1))).toBe(1);
		expect(test.slides.moving).toBe(false);
	});

	it("clears its timers when a dial goes away", () => {
		using test = setup();
		test.paint("a", at(0));
		test.slides.turn("a");
		test.paint("a", at(1));
		test.slides.stop("a");
		expect(test.slides.moving).toBe(false);
		vi.advanceTimersByTime(SLIDE.debounceMs + SLIDE.durationMs);
		expect(test.frames).toEqual([]);
		expect(vi.getTimerCount()).toBe(0);
	});
});
