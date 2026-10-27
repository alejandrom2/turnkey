/**
 * Feedback for `layouts/strip.json`, the Classic dial geometry: a header, a 38px icon, a value line and a detail line.
 * A line wider than its slot is drawn as a picture (`valueArt`/`detailArt`) so the marquee can scroll it.
 */
import type { MarqueeLine } from "./marquee.js";
import { BLANK_ART, lineArt, type StripAppearance, stripCanvas, type StripTone, textWidth, wrapText } from "./render.js";

export type StripLine = "value" | "detail";

export type StripContent = {
	header: string;
	/** A 38×38 data URL: a glyph or a provider mark. */
	icon: string;
	/** Hairline colour. */
	accent: string;
	value: string;
	detail?: string;
	detailColor?: string;
	tone?: StripTone;
	ultrathink?: boolean;
	/** The lines that may scroll, in order of preference; both by default, the value first. */
	scroll?: StripLine[];
};

export const STRIP_LINES: Record<StripLine, { width: number; height: number; size: number; weight: number; color: string }> = {
	value: { width: 136, height: 22, size: 16, weight: 650, color: "#FFFFFF" },
	detail: { width: 136, height: 23, size: 14, weight: 600, color: "#B8BCC6" },
};

/** Room left at the end of a scroll, and slack for the width estimate against the native font. */
const END_PAD = 6;

/** How far `text` runs past its slot, in px; 0 when it fits. */
export function overflowOf(text: string, line: StripLine): number {
	const { width, size } = STRIP_LINES[line];
	const measured = textWidth(text, size);
	return measured <= width - 2 ? 0 : Math.ceil(measured - width + END_PAD);
}

/** The line the marquee scrolls: the first allowed one that overflows. */
export function scrollingLine(content: StripContent): (MarqueeLine & { line: StripLine; text: string }) | undefined {
	for (const line of content.scroll ?? ["value", "detail"]) {
		const text = (line === "value" ? content.value : content.detail) ?? "";
		const overflow = overflowOf(text, line);
		if (overflow > 0) return { line, text, overflow, key: `${line}:${text}` };
	}
	return undefined;
}

/** `text` across both lines: the first word-wrapped to the value slot, the rest below. */
export function twoLines(text: string): [string, string] {
	const clean = text.trim().replace(/\s+/g, " ");
	const [first = ""] = wrapText(clean, STRIP_LINES.value.width, STRIP_LINES.value.size, 2).lines;
	return [first, clean.slice(first.length).trim()];
}

export type StripOptions = {
	appearance: StripAppearance;
	/** The scrolling line's offset, in px. */
	offset?: number;
	/** Shows this text across both lines instead: a long touch or a refusal reason. */
	full?: string;
};

export function stripFeedback(content: StripContent, options: StripOptions): Record<string, string | { value: string; color: string }> {
	const base = {
		canvas: stripCanvas(content.accent, options.appearance, content.tone ?? "neutral", content.ultrathink === true),
		header: content.header,
		glyph: content.icon,
	};
	if (options.full !== undefined) {
		const [first, rest] = twoLines(options.full);
		return { ...base, value: first, detail: { value: rest, color: STRIP_LINES.value.color }, valueArt: BLANK_ART, detailArt: BLANK_ART };
	}
	const scrolling = scrollingLine(content);
	const line = (which: StripLine, text: string, color: string) => {
		const overflow = overflowOf(text, which);
		if (overflow === 0) return { text: { value: text, color }, art: BLANK_ART };
		const offset = scrolling?.line === which ? Math.min(overflow, Math.max(0, options.offset ?? 0)) : 0;
		return { text: { value: "", color }, art: lineArt({ ...STRIP_LINES[which], text, color, offset, overflow }) };
	};
	const value = line("value", content.value, STRIP_LINES.value.color);
	const detail = line("detail", content.detail ?? "", content.detailColor ?? STRIP_LINES.detail.color);
	return { ...base, value: value.text, detail: detail.text, valueArt: value.art, detailArt: detail.art };
}
