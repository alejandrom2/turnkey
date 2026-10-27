import { describe, expect, it } from "vitest";

import { BLANK_ART, DEFAULT_APPEARANCE, resolveAppearance, stripCanvas, toneOf } from "./render.js";
import { overflowOf, scrollingLine, type StripContent, stripFeedback, twoLines } from "./strip.js";

const svg = (dataUrl: unknown) => Buffer.from(String(dataUrl).replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

const LONG = "Refactor the websocket reconnect logic so tunnels survive sleep";
const content = (patch: Partial<StripContent> = {}): StripContent => ({ header: "Threads", icon: BLANK_ART, accent: "#5B8CFF", value: "Short", detail: "Done", ...patch });

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
});

describe("strip appearance", () => {
	it("defaults to T3 Code's card with the hairline on, and lets a dial override the global setting", () => {
		expect(resolveAppearance({})).toEqual({ background: "t3", hairline: true });
		expect(resolveAppearance({ stripBackground: "elgato", stripHairline: false })).toEqual({ background: "elgato", hairline: false });
		expect(resolveAppearance({ stripBackground: "elgato" }, { background: "state" }).background).toBe("state");
		expect(resolveAppearance({ stripBackground: "elgato" }, { background: "" }).background).toBe("elgato");
	});

	it("accepts only #rrggbb custom colours, the dial's own when it overrides", () => {
		expect(resolveAppearance({ stripBackground: "custom", stripColor: "#336699" })).toMatchObject({ background: "custom", color: "#336699" });
		expect(resolveAppearance({ stripBackground: "custom", stripColor: "red\"/><script" }).background).toBe("t3");
		expect(resolveAppearance({ stripColor: "#336699" }, { background: "custom", backgroundColor: "#112233" }).color).toBe("#112233");
	});

	it("draws each background, tints by thread state, and can drop the hairline", () => {
		expect(svg(stripCanvas("#5B8CFF"))).toContain(`fill="#121212"`);
		expect(svg(stripCanvas("#5B8CFF", { background: "elgato", hairline: true }))).toContain("#241640");
		expect(svg(stripCanvas("#5B8CFF", { background: "custom", color: "#336699", hairline: true }))).toContain(`fill="#336699"`);
		expect(svg(stripCanvas("#5B8CFF", { background: "state", hairline: true }, toneOf("failed")))).toContain("#FF6764");
		expect(svg(stripCanvas("#5B8CFF", { background: "state", hairline: true }, toneOf("running")))).not.toContain("stop-opacity");
		expect(svg(stripCanvas("#5B8CFF", { background: "t3", hairline: false }))).not.toContain("#5B8CFF");
		expect(svg(stripCanvas("#5B8CFF", DEFAULT_APPEARANCE, "neutral", true))).toContain(`stroke="url(#ultrathink)"`);
	});

	it("maps thread states to tones", () => {
		expect([toneOf("done"), toneOf("failed"), toneOf("approval"), toneOf("question"), toneOf("running"), toneOf("idle")]).toEqual(["done", "failed", "attention", "attention", "neutral", "neutral"]);
	});
});
