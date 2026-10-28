import { describe, expect, it } from "vitest";

import { COLORS, STATE_COLOR } from "../core/render.js";
import type { DeckState } from "../core/t3/shell.js";
import { ringFace, stopFace, stopTarget, urgentFace } from "./ring.js";

const thread = (deck: DeckState, unseen = false) => ({ deck, unseen });

describe("urgentFace", () => {
	it("shows the top thread waiting on you, with how many wait", () => {
		expect(urgentFace([thread("approval"), thread("question"), thread("running")])).toBe(ringFace(STATE_COLOR.approval, "shield", { badge: 2 }));
		expect(urgentFace([thread("question"), thread("running")])).toBe(ringFace(STATE_COLOR.question, "question"));
	});

	it("shows a running thread, then an unseen result", () => {
		expect(urgentFace([thread("running")])).toBe(ringFace(STATE_COLOR.running, "running"));
		expect(urgentFace([thread("failed", true)])).toBe(ringFace(STATE_COLOR.failed, "error"));
		expect(urgentFace([thread("done", true)])).toBe(ringFace(STATE_COLOR.done, "checkBare"));
	});

	it("is all clear when nothing needs you", () => {
		const clear = ringFace(COLORS.muted, "checkBare");
		expect(urgentFace([])).toBe(clear);
		expect(urgentFace([thread("done"), thread("idle")])).toBe(clear);
	});

	it("caps the badge", () => {
		expect(urgentFace(Array.from({ length: 12 }, () => thread("approval")))).toBe(ringFace(STATE_COLOR.approval, "shield", { badge: "9+" }));
	});
});

describe("stop", () => {
	it("targets the running thread that started last, which the board lists first", () => {
		const newer = { deck: "running" as const, id: "newer" };
		expect(stopTarget([{ deck: "approval", id: "a" }, newer, { deck: "running", id: "older" }])).toBe(newer);
		expect(stopTarget([{ deck: "done", id: "a" }])).toBeUndefined();
	});

	it("dims when there's nothing to stop", () => {
		expect(stopFace(true)).toBe(ringFace(COLORS.accent, "stop"));
		expect(stopFace(false)).toBe(ringFace(COLORS.accent, "stop", { dim: true }));
		expect(stopFace(false)).not.toBe(stopFace(true));
	});
});
