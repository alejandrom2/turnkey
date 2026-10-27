import { describe, expect, it } from "vitest";

import { DEFAULT_APPEARANCE, glyphArt } from "./render.js";
import type { StripContent } from "./strip.js";
import {
	carouselFeedback,
	carouselTiles,
	listFeedback,
	listFromContent,
	listReading,
	listRows,
	READING,
	resolveStripStyle,
	scrollReading,
	type StripList,
	styleFlash,
	styleLine,
} from "./styles.js";

const svg = (dataUrl: unknown) => Buffer.from(String(dataUrl).replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

const LONG = "Refactor the websocket reconnect logic so tunnels survive sleep";
const content: StripContent = { header: "Threads", icon: glyphArt("check"), accent: "#5B8CFF", value: "Short", detail: "Done" };
const list = (count: number, index: number, patch: Partial<StripList> = {}): StripList => ({
	heading: "Needs you",
	items: Array.from({ length: count }, (_, at) => ({ key: `t${at}`, label: `Thread ${at + 1}`, art: glyphArt("check") })),
	index,
	...patch,
});

describe("resolveStripStyle", () => {
	it("takes the dial's own choice, then the global one, then Elgato's layout scrolling sideways", () => {
		expect(resolveStripStyle({})).toEqual({ style: "classic", scroll: "horizontal" });
		expect(resolveStripStyle({ stripStyle: "list", textScroll: "vertical" })).toEqual({ style: "list", scroll: "vertical" });
		expect(resolveStripStyle({ stripStyle: "list", textScroll: "vertical" }, { stripStyle: "carousel", textScroll: "off" })).toEqual({ style: "carousel", scroll: "off" });
		expect(resolveStripStyle({ stripStyle: "carousel" }, { stripStyle: "", textScroll: "" })).toEqual({ style: "carousel", scroll: "horizontal" });
		expect(resolveStripStyle({ stripStyle: "wheel", textScroll: 3 }, { stripStyle: "nope" })).toEqual({ style: "classic", scroll: "horizontal" });
	});
});

describe("listRows", () => {
	it("shows the previous, selected, next and following item, stopping at the ends", () => {
		expect(listRows(12, 2)).toEqual({ previous: 1, selected: 2, next: 3, after: 4 });
		expect(listRows(12, 0)).toEqual({ previous: undefined, selected: 0, next: 1, after: 2 });
		expect(listRows(12, 11)).toEqual({ previous: 10, selected: 11, next: undefined, after: undefined });
		expect(listRows(1, 0)).toEqual({ selected: 0 });
	});

	it("comes round a cycling list without showing an item twice", () => {
		expect(listRows(5, 0, true)).toEqual({ previous: 4, selected: 0, next: 1, after: 2 });
		expect(listRows(5, 4, true)).toEqual({ previous: 3, selected: 4, next: 0, after: 1 });
		expect(listRows(3, 0, true)).toEqual({ previous: 2, selected: 0, next: 1, after: undefined });
		expect(listRows(2, 1, true)).toEqual({ previous: undefined, selected: 1, next: 0, after: undefined });
	});
});

describe("listFeedback", () => {
	it("fills the rows around the selection, with a counter and the selected item's glyph", () => {
		const feedback = listFeedback(content, list(12, 2), { appearance: DEFAULT_APPEARANCE, scroll: "horizontal" });
		expect(feedback).toMatchObject({ heading: "Needs you", counter: "3/12", previous: { value: "Thread 2" }, selected: { value: "Thread 3" }, next: { value: "Thread 4" }, after: { value: "Thread 5" } });
		expect(svg(feedback.glyph)).toContain('width="18"');
	});

	it("gives the last row to a note", () => {
		const feedback = listFeedback(content, list(2, 0, { note: { text: "Press to apply", color: "#FF8549" } }), { appearance: DEFAULT_APPEARANCE, scroll: "horizontal" });
		expect(feedback.after).toEqual({ value: "Press to apply", color: "#FF8549" });
	});

	it("draws an overflowing selection as a picture that follows the text scroll", () => {
		const long = list(3, 1);
		long.items[1]!.label = LONG;
		expect(styleLine("list", long, "off")?.roll).toBeUndefined();
		const rolled = styleLine("list", long, "vertical");
		expect(rolled?.roll?.lines.length).toBeGreaterThan(1);
		const feedback = listFeedback(content, long, { appearance: DEFAULT_APPEARANCE, scroll: "vertical", offset: 20 });
		expect(feedback.selected).toMatchObject({ value: "" });
		expect(svg(feedback.selectedArt)).toContain(rolled!.roll!.lines[1]!);
	});

	it("shows a face with nothing to browse as one item, its detail as the note", () => {
		const feedback = listFeedback(content, listFromContent(content), { appearance: DEFAULT_APPEARANCE, scroll: "horizontal" });
		expect(feedback).toMatchObject({ counter: "", previous: { value: "" }, selected: { value: "Short" }, next: { value: "" }, after: { value: "Done" } });
	});
});

describe("reading view", () => {
	it("wraps the label, detail and note, and scrolls a line per tick within the text", () => {
		const long = list(3, 1, { note: { text: "Press to apply" } });
		long.items[1] = { ...long.items[1]!, label: LONG, detail: "Done · +12 −3 after a long run of the full test suite\nmy-project" };
		const lines = listReading(long);
		expect(lines.length).toBeGreaterThan(READING.visible);
		expect(lines.at(-1)).toBe("Press to apply");
		expect(scrollReading(0, -1, lines.length, READING.visible)).toBe(0);
		expect(scrollReading(0, 1, lines.length, READING.visible)).toBe(1);
		expect(scrollReading(0, 99, lines.length, READING.visible)).toBe(lines.length - READING.visible);
		expect(scrollReading(0, 3, 3, READING.visible)).toBe(0);
		const feedback = carouselFeedback(content, long, { appearance: DEFAULT_APPEARANCE, scroll: "horizontal", reading: { lines, top: 1 } });
		expect(svg(feedback.art)).toContain(lines[1]!);
		expect(svg(feedback.art)).not.toContain(`>${lines[0]}<`);
	});
});

describe("carousel", () => {
	const tiles = (art: string) => (art.match(/<g opacity/g) ?? []).length;

	it("draws the item between its neighbors, and none past the ends of a list that stops", () => {
		expect(tiles(carouselTiles(list(5, 2), 2))).toBe(3);
		expect(tiles(carouselTiles(list(5, 0), 0))).toBe(2);
		expect(tiles(carouselTiles(list(5, 0, { wrap: true }), 0))).toBe(3);
		expect(tiles(carouselTiles(list(1, 0), 0))).toBe(1);
	});

	it("titles the item nearest the position", () => {
		const feedback = carouselFeedback(content, list(5, 2), { appearance: DEFAULT_APPEARANCE, scroll: "horizontal", position: 2.6 });
		expect(feedback.title).toMatchObject({ value: "Thread 4" });
	});

	it("shows a long press result wrapped instead of cut off", () => {
		expect(styleFlash("carousel", true, "Sent", DEFAULT_APPEARANCE).title).toMatchObject({ value: "Sent" });
		expect(svg(styleFlash("carousel", false, LONG, DEFAULT_APPEARANCE).art)).toContain("Refactor");
		expect(styleFlash("list", false, LONG, DEFAULT_APPEARANCE)).toMatchObject({ heading: "Not now", next: { value: expect.stringMatching(/\w/) } });
	});
});
