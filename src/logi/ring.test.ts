import { describe, expect, it } from "vitest";

import type { CatalogModel } from "../core/models.js";
import { COLORS, STATE_COLOR } from "../core/render.js";
import type { DeckState } from "../core/t3/shell.js";
import { continueFace, customPromptFace, effortFace, limitsFace, limitsLabel, modeFace, modelFace, promptFace, ringFace, settingsFace, statusFace, statusLabel, stopAllFace, stopFace, stopTarget, urgentFace, runningFace, waitingFace } from "./ring.js";

const thread = (deck: DeckState, unseen = false) => ({ deck, unseen });

describe("urgentFace", () => {
	it("shows the top thread waiting on you, with how many wait", () => {
		expect(urgentFace([thread("approval"), thread("question"), thread("running")])).toBe(ringFace(STATE_COLOR.approval, "shield", { badge: 2 }));
		expect(urgentFace([thread("question"), thread("running")])).toBe(ringFace(STATE_COLOR.question, "question"));
	});

	it("shows work in progress, then a failure you haven't seen", () => {
		expect(urgentFace([thread("running")])).toBe(ringFace(STATE_COLOR.running, "pulse"));
		expect(urgentFace([thread("failed", true)])).toBe(ringFace(STATE_COLOR.failed, "error"));
	});

	it("is all done when nothing waits, runs or failed unseen, without a check that reads as approving", () => {
		const done = ringFace(STATE_COLOR.done, "spark");
		expect(urgentFace([])).toBe(done);
		expect(urgentFace([thread("done", true)])).toBe(done);
		expect(urgentFace([thread("done"), thread("failed"), thread("idle")])).toBe(done);
	});

	it("caps the badge", () => {
		expect(urgentFace(Array.from({ length: 12 }, () => thread("approval")))).toBe(ringFace(STATE_COLOR.approval, "shield", { badge: "9+" }));
	});
});

describe("stop", () => {
	it("targets the running thread that started last, which the board lists first", () => {
		const newer = { deck: "running" as const, key: "newer" };
		expect(stopTarget([{ deck: "approval", key: "a" }, newer, { deck: "running", key: "older" }], undefined)).toBe(newer);
		expect(stopTarget([{ deck: "done", key: "a" }], undefined)).toBeUndefined();
	});

	it("stops the selected thread while it runs", () => {
		const older = { deck: "running" as const, key: "older" };
		expect(stopTarget([{ deck: "running", key: "newer" }, older], older)).toBe(older);
	});

	it("else the newest running", () => {
		const newer: { deck: DeckState; key: string } = { deck: "running", key: "newer" };
		expect(stopTarget([newer], { deck: "done", key: "idle" })).toBe(newer);
	});

	it("dims when there's nothing to stop", () => {
		expect(stopFace(true)).toBe(ringFace(COLORS.accent, "stop"));
		expect(stopFace(false)).toBe(ringFace(COLORS.accent, "stop", { dim: true }));
		expect(stopFace(false)).not.toBe(stopFace(true));
	});
});


describe("settingsFace", () => {
	it("is Turnkey's sliders in its accent", () => {
		expect(settingsFace()).toBe(ringFace(COLORS.accent, "sliders"));
	});
});

describe("the controls' faces", () => {
	it("draws each prompt as its own glyph, in full color so it always says which prompt it is", () => {
		expect(promptFace("test")).toBe(ringFace(COLORS.accent, "scriptTest"));
		expect(promptFace("commit")).toBe(ringFace(COLORS.accent, "gitCommit"));
		expect(new Set((["test", "fix", "explain", "commit"] as const).map((name) => promptFace(name))).size).toBe(4);
	});

	it("draws a custom prompt as Send's arrow, dimmed only while it has no text", () => {
		expect(customPromptFace(true)).toBe(ringFace(COLORS.accent, "send"));
		expect(customPromptFace(false)).toBe(ringFace(COLORS.accent, "send", { dim: true }));
	});

	it("shows what Continue will do", () => {
		expect(continueFace("send")).toBe(ringFace(COLORS.accent, "play"));
		expect(continueFace("open")).toBe(ringFace(STATE_COLOR.approval, "shield"));
		expect(continueFace(undefined)).toBe(ringFace(COLORS.accent, "play", { dim: true }));
	});

	it("dims Stop all with nothing running, and counts what it would stop", () => {
		expect(stopAllFace(0)).toBe(ringFace(COLORS.error, "stop", { dim: true }));
		expect(stopAllFace(3)).toBe(ringFace(COLORS.error, "stop", { badge: 3 }));
	});

	it("colors a limit by how close it is, around the gauge glyph, and names it on hover", () => {
		expect(limitsFace(40, false)).toContain(COLORS.done);
		expect(limitsFace(80, false)).toContain(STATE_COLOR.approval);
		expect(limitsFace(95, false)).toContain(COLORS.error);
		expect(limitsFace(62, false)).not.toContain("<text");
		expect(limitsFace(undefined, false)).toBe(ringFace(COLORS.muted, "gauge", { dim: true }));
		expect(limitsLabel("claudeAgent", "5-hour", 82.4)).toBe("Claude · 5-hour: 82% used");
		const claude = limitsFace(40, false, "claudeAgent");
		expect(claude).toContain(COLORS.done);
		expect(claude).not.toContain(limitsFace(40, false).match(/<g transform[^>]*>/)![0]);
	});

	it("splits threads into what waits on you and what runs, each counted, dimmed at none", () => {
		const threads = [thread("approval"), thread("question"), thread("running"), thread("done")];
		expect(waitingFace(threads)).toBe(ringFace(STATE_COLOR.approval, "shield", { badge: 2 }));
		expect(runningFace(threads)).toBe(ringFace(STATE_COLOR.running, "pulse", { badge: 1 }));
		expect(waitingFace([])).toBe(ringFace(COLORS.muted, "shield", { dim: true }));
		expect(runningFace([])).toBe(ringFace(COLORS.muted, "pulse", { dim: true }));
	});

	it("shows what waits on you first, else what runs, and both counts on hover", () => {
		expect(statusFace({ approval: 1, question: 1, running: 3 })).toBe(ringFace(STATE_COLOR.approval, "queued", { badge: 2 }));
		expect(statusFace({ approval: 0, question: 0, running: 3 })).toBe(ringFace(STATE_COLOR.running, "queued", { badge: 3 }));
		expect(statusFace({ approval: 0, question: 0, running: 0 })).toBe(ringFace(COLORS.muted, "queued", { dim: true }));
		expect(statusLabel({ approval: 1, question: 1, running: 3 })).toBe("2 wait on you · 3 running");
	});

	it("shows the selected thread's access mode and effort, dimmed without one", () => {
		expect(modeFace("auto")).toBe(ringFace(COLORS.accent, "modeAuto"));
		expect(modeFace("full-access")).toBe(ringFace(STATE_COLOR.approval, "modeFullAccess"));
		expect(modeFace(undefined)).toBe(ringFace(COLORS.muted, "modeSupervised", { dim: true }));
		expect(effortFace(undefined)).toBe(ringFace(COLORS.muted, "effort", { dim: true }));
		expect(effortFace({ index: 1, count: 3, color: "#648FFD" })).not.toBe(effortFace({ index: 2, count: 3, color: "#648FFD" }));
	});

	it("colors effort by its level", () => {
		expect(effortFace({ index: 1, count: 4, color: "#AD7BF9" })).toContain('stroke="#AD7BF9"');
	});

	it("shows a picker model by its provider's mark alone, sets the thread's own apart, and dims an empty slot", () => {
		const opus: CatalogModel = {
			key: "claudeAgent:claude-opus-4-5",
			instanceId: "claudeAgent",
			slug: "claude-opus-4-5",
			driver: "claudeAgent",
			providerName: "Claude",
			name: "Claude Opus 4.5",
			label: "Claude · Opus 4.5",
			accentColor: "#123456",
			iconUrl: undefined,
			badge: false,
			options: [],
		};
		const other = modelFace(opus, false);
		expect(other).not.toContain("Opus");
		expect(other).not.toContain("<text");
		expect(modelFace(opus, true)).toContain(`<circle cx="111" cy="111" r="21" fill="${COLORS.key}"/>`);
		expect(other).not.toContain("<circle");
		expect(modelFace(undefined, false)).toBe(ringFace(COLORS.muted, "model", { dim: true }));
	});
});
