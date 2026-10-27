import { afterEach, describe, expect, it, vi } from "vitest";

import { confirmMode, REVIEW, Reviews } from "./review.js";

describe("confirmMode", () => {
	it("takes the action's own setting, else the global one, else Review", () => {
		expect(confirmMode("hold", "off")).toBe("hold");
		expect(confirmMode("", "off")).toBe("off");
		expect(confirmMode(undefined, undefined)).toBe("review");
	});
});

describe("Reviews", () => {
	afterEach(() => vi.useRealTimers());

	function setup() {
		vi.useFakeTimers();
		let now = 0;
		const ended: string[] = [];
		const reviews = new Reviews((owner) => ended.push(owner), () => now);
		return { reviews, ended, at: (ms: number) => (now = ms) };
	}

	it("shows the card first, ignores a second press under 750 ms, and confirms with what it reviewed", () => {
		const { reviews, at } = setup();
		expect(reviews.press("key", "thread|text", "restart")).toEqual({ kind: "review" });
		expect(reviews.detail("key", "thread|text")).toBe("restart");
		expect(reviews.detail("key", "other")).toBeUndefined();
		at(REVIEW.minMs - 1);
		expect(reviews.press("key", "thread|text", "auto")).toEqual({ kind: "wait" });
		at(REVIEW.minMs);
		expect(reviews.press("key", "thread|text", "auto")).toEqual({ kind: "confirm", detail: "restart" });
		expect(reviews.scope("key")).toBeUndefined();
	});

	it("reviews again when anything changed or the card expired", () => {
		const { reviews, ended, at } = setup();
		reviews.press("key", "a");
		at(1_000);
		expect(reviews.press("key", "b")).toEqual({ kind: "review" });
		at(1_000 + REVIEW.maxMs);
		vi.advanceTimersByTime(REVIEW.maxMs);
		expect(ended).toEqual(["key"]);
		expect(reviews.press("key", "b")).toEqual({ kind: "review" });
	});

	it("keeps one review on the deck: another instance's press ends the first card", () => {
		const { reviews, ended } = setup();
		reviews.press("one", "a");
		reviews.press("two", "a");
		expect(ended).toEqual(["one"]);
		expect(reviews.scope("one")).toBeUndefined();
		expect(reviews.cancel("two")).toBe(true);
		expect(reviews.cancel("two")).toBe(false);
	});
});
