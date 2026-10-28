import { describe, expect, it } from "vitest";

import { activityBar, renderActivityBar, renderInfoBar, renderLimitBar, threadCounts } from "./infobar.js";
import { COLORS } from "./render.js";

const thread = (deck: "approval" | "question" | "running" | "done" | "idle", title: string = deck) => ({ deck, title, activeSince: undefined, projectTitle: "" });

describe("activityBar", () => {
	it("shows the first matching thread, with counts across every thread", () => {
		const all = [thread("approval", "Fix login"), thread("question"), thread("running"), thread("running"), thread("done")];
		const bar = activityBar([all[2]!, all[3]!], all, "All quiet", 0);
		expect(bar).toMatchObject({ kind: "thread", state: "running", title: "running", counts: { approval: 1, question: 1, running: 2 } });
	});

	it("says all quiet when nothing matches, and keeps the counts", () => {
		expect(activityBar([], [thread("running")], "All quiet", 0)).toEqual({ kind: "empty", label: "All quiet", counts: { approval: 0, question: 0, running: 1 } });
	});

	it("adds the project to the state line", () => {
		const bar = activityBar([{ ...thread("idle"), projectTitle: "t3code" }], [], "", 0);
		expect(bar.kind === "thread" && bar.detail).toContain("t3code");
	});
});

describe("threadCounts", () => {
	it("counts only approvals, questions and running turns", () => {
		expect(threadCounts([thread("done"), thread("idle"), thread("approval")])).toEqual({ approval: 1, question: 0, running: 0 });
	});
});

describe("renderActivityBar", () => {
	it("draws the Neo info bar's size and a chip per nonzero count", () => {
		const svg = Buffer.from(renderActivityBar({ kind: "empty", label: "All quiet", counts: { approval: 2, question: 0, running: 1 } }).split(",")[1]!, "base64").toString();
		expect(svg).toContain(`width="232" height="50"`);
		expect(svg.match(/<circle/g)).toHaveLength(2);
	});
});

const svgOf = (face: string) => Buffer.from(face.split(",")[1]!, "base64").toString();

describe("renderLimitBar", () => {
	it("turns amber at 60% used and red at 80%, whatever the percent shows", () => {
		const bar = (used: number) => svgOf(renderLimitBar({ label: "Codex · Weekly", percent: 100 - used, used: used / 100, detail: "" }));
		expect(bar(40)).toContain(COLORS.done);
		expect(bar(65)).toContain(COLORS.attention);
		expect(bar(85)).toContain(COLORS.error);
	});

	it("marks even pace on the bar only when the window has a clock", () => {
		const marker = /<rect x="\d+" y="25"/;
		expect(svgOf(renderLimitBar({ label: "Weekly", percent: 50, used: 0.5, pace: 0.4, detail: "" }))).toMatch(marker);
		expect(svgOf(renderLimitBar({ label: "Weekly", percent: 50, used: 0.5, detail: "" }))).not.toMatch(marker);
	});
});

describe("renderInfoBar", () => {
	it("puts a word or a glyph right of the title", () => {
		const word = svgOf(renderInfoBar({ icon: { glyph: "queued", color: COLORS.text }, title: "2 queued", detail: "Refactor billing", right: { text: "Held", color: COLORS.attention } }));
		expect(word).toContain(">Held<");
		const plain = svgOf(renderInfoBar({ icon: { glyph: "model", color: COLORS.text }, title: "GPT-5", detail: "High" }));
		const bolt = svgOf(renderInfoBar({ icon: { glyph: "model", color: COLORS.text }, title: "GPT-5", detail: "High", right: { glyph: "bolt", color: COLORS.accent } }));
		expect(bolt.length).toBeGreaterThan(plain.length);
	});
});
