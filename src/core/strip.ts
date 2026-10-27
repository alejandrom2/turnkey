/**
 * Feedback for `layouts/strip.json`, Elgato's dial geometry: a header, a 38px icon, a value line and a detail line.
 * A line wider than its slot is drawn as a picture (`valueArt`/`detailArt`) so the marquee can scroll it.
 */
import type { MarqueeLine } from "./marquee.js";
import { BLANK_ART, COLORS, lineArt, type MarkPainter, rollArt, skeletonRect, type StripAppearance, stripCanvas, stripMarkIcon, type StripTone, svgImage, textWidth, wrapText } from "./render.js";

type StripLine = "value" | "detail";

/** How text too long for its slot moves: sideways, rolled up line by line, or not at all (it fades at the edge). */
export type TextScroll = "horizontal" | "vertical" | "off";

export type StripContent = {
	header: string;
	/** Drawn in the 38×38 icon slot: a glyph or a provider mark. */
	icon: MarkPainter;
	/** Hairline color. */
	accent: string;
	value: string;
	detail?: string;
	detailColor?: string;
	tone?: StripTone;
	ultrathink?: boolean;
	/** The lines that may scroll, in order of preference; both by default, the value first. */
	scroll?: StripLine[];
	/** The face moves (a spinner) and wants animation frames. */
	moving?: boolean;
	/** The detail is still loading: a placeholder bar stands in for it. */
	loading?: boolean;
};

/** A text item's box and font. */
export type TextSlot = { width: number; height: number; size: number; weight: number; color: string };

export const STRIP_LINES: Record<StripLine, TextSlot> = {
	value: { width: 136, height: 22, size: 16, weight: 650, color: "#FFFFFF" },
	detail: { width: 136, height: 23, size: 14, weight: 600, color: COLORS.secondary },
};

/** Room left at the end of a scroll, and slack for the width estimate against the native font. */
const END_PAD = 6;

/** How far `text` runs past `slot`, in px; 0 when it fits. */
export function overflowIn(text: string, slot: Pick<TextSlot, "width" | "size">): number {
	const measured = textWidth(text, slot.size);
	return measured <= slot.width - 2 ? 0 : Math.ceil(measured - slot.width + END_PAD);
}

export const overflowOf = (text: string, line: StripLine): number => overflowIn(text, STRIP_LINES[line]);

/** An overflowing line as the marquee moves it: sideways by its overflow, or rolled up through its wrapped lines. */
export type ScrollLine = MarqueeLine & { text: string };

export function scrollLine(text: string, slot: TextSlot, scroll: TextScroll, name: string): ScrollLine | undefined {
	const overflow = overflowIn(text, slot);
	if (overflow === 0) return undefined;
	if (scroll === "vertical") {
		const { lines } = wrapText(text, slot.width - END_PAD, slot.size, 40);
		if (lines.length > 1) return { key: `${name}:roll:${text}`, text, overflow: lines.length * slot.height, roll: { lines, height: slot.height } };
	}
	return { key: `${name}:${text}`, text, overflow };
}

/** `text` in `slot`: native text when it fits, else a picture at the line's scroll `offset` (faded at rest). */
export function slotItems(text: string, slot: TextSlot, color: string, line: ScrollLine | undefined, offset = 0): { text: { value: string; color: string }; art: string } {
	const overflow = overflowIn(text, slot);
	if (overflow === 0) return { text: { value: text, color }, art: BLANK_ART };
	const moving = line?.text === text ? Math.max(0, offset) : 0;
	if (line?.roll && line.text === text) return { text: { value: "", color }, art: rollArt({ ...slot, color, lines: line.roll.lines, offset: moving }) };
	return { text: { value: "", color }, art: lineArt({ ...slot, text, color, offset: Math.min(overflow, moving), overflow }) };
}

/** The line the marquee scrolls: the first allowed one that overflows. */
export function scrollingLine(content: StripContent, scroll: TextScroll = "horizontal"): (ScrollLine & { line: StripLine }) | undefined {
	for (const line of content.scroll ?? ["value", "detail"]) {
		const found = scrollLine((line === "value" ? content.value : content.detail) ?? "", STRIP_LINES[line], scroll, line);
		if (found) return { ...found, line };
	}
	return undefined;
}

/** How many wrapped lines the reading view has for `text`; it shows two at a time. */
export const readingLength = (text: string): number => wrapText(text, STRIP_LINES.value.width, STRIP_LINES.value.size, 99).lines.length;

/** `text` across both lines from wrapped line `top`: that line in the value slot, the rest below. */
export function twoLines(text: string, top = 0): [string, string] {
	let rest = text.trim().replace(/\s+/g, " ");
	for (let index = 0; ; index++) {
		const [line = ""] = wrapText(rest, STRIP_LINES.value.width, STRIP_LINES.value.size, 2).lines;
		const after = rest.slice(line.length).trim();
		if (index >= top || after === "") return [line, after];
		rest = after;
	}
}

type StripOptions = {
	appearance: StripAppearance;
	/** The scrolling line's offset, in px. */
	offset?: number;
	scroll?: TextScroll;
	/** Shows this text across both lines instead: a long touch or a refusal reason. */
	full?: string;
	/** The wrapped line of `full` shown first. */
	top?: number;
};

/** A static placeholder bar `width` px long in a `slot`-sized picture: data on its way. */
const skeletonBar = (slot: Pick<TextSlot, "width" | "height">, width: number, x = 0): string =>
	svgImage(slot.width, slot.height, skeletonRect(x, (slot.height - 12) / 2, width, 12));

export function stripFeedback(content: StripContent, options: StripOptions): Record<string, string | { value: string; color: string }> {
	const base = {
		canvas: stripCanvas(content.accent, options.appearance, content.tone ?? "neutral", content.ultrathink === true),
		header: content.header,
		glyph: stripMarkIcon(content.icon),
	};
	if (options.full !== undefined) {
		const [first, rest] = twoLines(options.full, options.top);
		return { ...base, value: first, detail: { value: rest, color: STRIP_LINES.value.color }, valueArt: BLANK_ART, detailArt: BLANK_ART };
	}
	const scrolling = scrollingLine(content, options.scroll);
	const line = (which: StripLine, text: string, color: string) =>
		slotItems(text, STRIP_LINES[which], color, scrolling?.line === which ? scrolling : undefined, options.offset);
	// Loading with nothing to say yet: both lines are placeholder bars, as the first connection draws them.
	const value =
		content.loading && content.value === ""
			? { text: { value: "", color: STRIP_LINES.value.color }, art: skeletonBar(STRIP_LINES.value, 112) }
			: line("value", content.value, STRIP_LINES.value.color);
	const detail = content.loading
		? { text: { value: "", color: STRIP_LINES.detail.color }, art: skeletonBar(STRIP_LINES.detail, 84) }
		: line("detail", content.detail ?? "", content.detailColor ?? STRIP_LINES.detail.color);
	return { ...base, value: value.text, detail: detail.text, valueArt: value.art, detailArt: detail.art };
}
