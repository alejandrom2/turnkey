import { describe, expect, it } from "vitest";

import { BLANK_ART, DEFAULT_APPEARANCE, resolveAppearance, stripCanvas, toneOf } from "./render.js";
import { overflowOf, readingLength, scrollingLine, STRIP_LINES, type StripContent, stripFeedback, twoLines } from "./strip.js";

const svg = (dataUrl: unknown) => Buffer.from(String(dataUrl).replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

const LONG = "Refactor the websocket reconnect logic so tunnels survive sleep";
const content = (patch: Partial<StripContent> = {}): StripContent => ({ header: "Threads", icon: () => "", value: "Short", detail: "Done", ...patch });

describe("strip lines", () => {
	it("measures overflow only for text wider than its slot", () => {
		expect(overflowOf("Short", "value")).toBe(0);
		expect(overflowOf(LONG, "value")).toBeGreaterThan(100);
	});

	it("scrolls the first allowed line that overflows", () => {
		expect(scrollingLine(content())).toBeUndefined();
		expect(scrollingLine(content({ detail: LONG }))?.line).toBe("detail");
		expect(scrollingLine(content({ value: LONG, detail: LONG }))?.line).toBe("value");
		expect(scrollingLine(content({ detail: LONG, scroll: ["value"] }))).toBeUndefined();
	});

	it("keeps fitting text native and draws overflowing text as a picture at the marquee's offset", () => {
		const fits = stripFeedback(content(), { appearance: DEFAULT_APPEARANCE });
		expect(fits).toMatchObject({ value: { value: "Short" }, valueArt: BLANK_ART, detailArt: BLANK_ART });
		const scrolled = stripFeedback(content({ value: LONG }), { appearance: DEFAULT_APPEARANCE, offset: 30 });
		expect(scrolled.value).toMatchObject({ value: "" });
		expect(svg(scrolled.valueArt)).toContain(`x="-30"`);
		expect(svg(scrolled.valueArt)).toContain("Refactor the websocket");
	});

	it("shows long text across both lines on a long touch or a refusal", () => {
		const [first, rest] = twoLines(LONG);
		expect(`${first} ${rest}`).toBe(LONG);
		expect(overflowOf(first, "value")).toBe(0);
		const full = stripFeedback(content({ value: LONG }), { appearance: DEFAULT_APPEARANCE, full: LONG });
		expect(full).toMatchObject({ value: first, detail: { value: rest }, valueArt: BLANK_ART });
	});

	it("starts the long-touch view at a later wrapped line as the dial scrolls it", () => {
		const count = readingLength(LONG);
		expect(count).toBeGreaterThan(2);
		const [, rest] = twoLines(LONG);
		const [second, after] = twoLines(LONG, 1);
		expect(rest.startsWith(second)).toBe(true);
		expect(`${second} ${after}`).toBe(rest);
		expect(twoLines(LONG, 99)[1]).toBe("");
	});

	it("rolls an overflowing line up through its wrapped lines when set to vertical", () => {
		const line = scrollingLine(content({ value: LONG }), "vertical");
		expect(line?.roll?.lines.join(" ")).toBe(LONG);
		const rolled = stripFeedback(content({ value: LONG }), { appearance: DEFAULT_APPEARANCE, scroll: "vertical", offset: STRIP_LINES.value.height });
		expect(svg(rolled.valueArt)).toContain(line!.roll!.lines[1]!);
	});
});

describe("strip appearance", () => {
	it("defaults to T3 Code's card, and lets a dial override the global setting", () => {
		expect(resolveAppearance({})).toEqual({ background: "t3" });
		expect(resolveAppearance({ stripBackground: "flow" })).toEqual({ background: "flow" });
		expect(resolveAppearance({ stripBackground: "flow" }, { background: "state" }).background).toBe("state");
		expect(resolveAppearance({ stripBackground: "flow" }, { background: "" }).background).toBe("flow");
	});

	it("accepts only #rrggbb custom colors, the dial's own when it overrides", () => {
		expect(resolveAppearance({ stripBackground: "custom", stripColor: "#336699" })).toMatchObject({ background: "custom", color: "#336699" });
		expect(resolveAppearance({ stripBackground: "custom", stripColor: "red\"/><script" }).background).toBe("t3");
		expect(resolveAppearance({ stripColor: "#336699" }, { background: "custom", backgroundColor: "#112233" }).color).toBe("#112233");
	});

	it("draws each background, tints by thread state, and draws no state line", () => {
		expect(svg(stripCanvas())).toContain(`fill="#121212"`);
		expect(svg(stripCanvas({ background: "flow", run: { length: 2, position: 1 } }))).toContain(`translate(-200 0)`);
		expect(svg(stripCanvas({ background: "custom", color: "#336699" }))).toContain(`fill="#336699"`);
		expect(svg(stripCanvas({ background: "state" }, toneOf("failed")))).toContain("#FF6764");
		expect(svg(stripCanvas({ background: "state" }, toneOf("running")))).not.toContain("stop-opacity");
		expect(svg(stripCanvas())).not.toContain(`y="95"`);
		expect(svg(stripCanvas(DEFAULT_APPEARANCE, "neutral", true))).toContain(`stroke="url(#ultrathink)"`);
	});

	it("maps thread states to tones, a seen done one neutral like its key", () => {
		expect([toneOf("done"), toneOf("failed"), toneOf("approval"), toneOf("question"), toneOf("running"), toneOf("idle")]).toEqual(["done", "failed", "attention", "attention", "neutral", "neutral"]);
		expect([toneOf("done", true), toneOf("done", false)]).toEqual(["done", "neutral"]);
	});

	it("reads the retired Gradient as T3 Code's background", () => {
		expect(resolveAppearance({ stripBackground: "gradient" }).background).toBe("t3");
		expect(resolveAppearance({}, { background: "gradient" }).background).toBe("t3");
		expect(resolveAppearance({ stripBackground: "flow" }).background).toBe("flow");
	});
});
