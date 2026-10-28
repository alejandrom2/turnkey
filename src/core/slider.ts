/**
 * The Power dial's slider face, drawn over the strip's background: the value top-left with small badges top-right,
 * a stepped track with the current value filled and a previewed one as a hollow thumb, and what the ends mean (or
 * what pressing does) along the bottom.
 */
import { COLORS, fadeMask, fit, type MarkPainter, type Paint, paintFill, pills, steppedTrack, svgImage, svgText, textWidth, trackStopX } from "./render.js";

/** A mark and a word on the bottom row; the word dims unless painted. */
type FooterItem = { mark: MarkPainter; text: string; paint?: Paint };

export type SliderInput = {
	label: string;
	labelColor?: string;
	/** How many stops the track has; a track draws at least two, pages one pill per stop. */
	stops: number;
	/** The thread's value, filled up to; -1 when it isn't on the track. */
	current: number;
	/** The value the dial points at before a press applies it. */
	preview?: number;
	/** The fill instead of the accent: a model's color, the top effort's paint or T3 Code's Ultrathink spectrum. */
	fill?: Paint;
	/** What each end of the track means. */
	ends: [string, string];
	/** Replaces the ends with a mark and a word at the left: the model slider's Speed. */
	footer?: { start?: FooterItem; end?: FooterItem };
	/** Replaces the ends: what pressing does, or why the dial can't act. */
	note?: { text: string; color?: string };
	/** Up to two 20 px badges at the top right, rightmost first. */
	badges?: MarkPainter[];
	/** A 20 px mark before the label: the provider, effort or mode icon. */
	lead?: MarkPainter;
	/** Dims the track: the dial can't act. */
	dim?: boolean;
	/** Sparkles over the fill for an effort level this far up its ladder (0 to 1); none below the middle. */
	sparkle?: number;
	/** The sparkles' twinkle step; undefined keeps them still. */
	twinkle?: number;
	/** One pill per choice instead of a filled track: for choices that are places, not levels (models). */
	pages?: boolean;
	/** Nothing goes on the bottom row at rest, so the pills sit lower, in its place. */
	lower?: boolean;
	/** How far an overflowing label has scrolled left, in px. */
	labelOffset?: number;
};

const SLIDER = { x: 12, width: 176, y: 41, height: 18 } as const;

/** The center of stop `index` of `stops` along the track. */
export const stopX = (index: number, stops: number): number => trackStopX(SLIDER.x, SLIDER.width, index, stops);

const BADGE = 20;

/** The label line as the marquee measures it. */
export const sliderLabelText = (input: Pick<SliderInput, "label">): string => input.label;

/** The room the label has beside the badges, as a text slot the marquee can scroll. */
const LEAD = BADGE + 6;

export const sliderLabelSlot = (input: Pick<SliderInput, "badges" | "lead">) => ({
	width: SLIDER.width - Math.min(2, input.badges?.length ?? 0) * (BADGE + 6) - (input.lead ? LEAD : 0) - 4,
	height: 22,
	size: 16,
	weight: 650,
	color: COLORS.text,
});

export function sliderArt(input: SliderInput): string {
	const badges = (input.badges ?? []).slice(0, 2);
	const parts: string[] = [];
	badges.forEach((badge, index) => parts.push(badge(SLIDER.x + SLIDER.width - BADGE - index * (BADGE + 6), 9, BADGE)));

	const labelRoom = sliderLabelSlot(input).width;
	const start = SLIDER.x + (input.lead ? LEAD : 0);
	if (input.lead) parts.push(input.lead(SLIDER.x, 9, BADGE));
	const labelColor = input.labelColor ?? COLORS.text;
	const overflow = textWidth(sliderLabelText(input), 16) - labelRoom;
	const label = (x: number, extra = "") => `<g${extra}>${svgText(input.label, x, 26, 16, 650, labelColor)}</g>`;
	if (overflow > 0) {
		const end = start + labelRoom;
		const offset = Math.min(Math.max(0, input.labelOffset ?? 0), overflow + 4);
		// At rest the tail fades out; while it scrolls the label is clipped to its room instead.
		const shape =
			offset === 0
				? fadeMask("slider-label", end - 22, end, { y: 0, width: 200, height: 34 })
				: `<defs><clipPath id="slider-label"><rect x="${start}" y="0" width="${labelRoom}" height="34"/></clipPath></defs>`;
		parts.push(shape, label(+(start - offset).toFixed(1), offset === 0 ? ` mask="url(#slider-label)"` : ` clip-path="url(#slider-label)"`));
	} else parts.push(label(start));

	if (input.pages) {
		const current = input.current >= 0 && input.current < input.stops ? input.current : undefined;
		const height = 12;
		const box = { x: SLIDER.x, y: SLIDER.y + (input.lower ? 16 : 0) + (SLIDER.height - height) / 2, width: SLIDER.width, height, gap: 6 };
		const pages = pills(box, input.stops, current, input.fill ?? COLORS.accent, "slider-page", input.preview);
		parts.push(input.dim ? `<g opacity=".45">${pages}</g>` : pages);
		return finish(parts, input);
	}
	const stops = Math.max(2, input.stops);
	const current = input.current >= 0 && input.current < stops ? input.current : undefined;
	const track = steppedTrack({ ...SLIDER, stops, current, preview: input.preview, paint: input.fill ?? COLORS.accent, id: "slider-fill", sparkle: input.sparkle, twinkle: input.twinkle });
	parts.push(input.dim ? `<g opacity=".45">${track}</g>` : track);
	return finish(parts, input);
}

/** The ends, a note or the footer under the track, and the finished picture. */
function finish(parts: string[], input: SliderInput): string {
	if (input.note) parts.push(svgText(fit(input.note.text, SLIDER.width, 15), SLIDER.x, 85, 15, 600, input.note.color ?? COLORS.muted));
	else if (input.footer) {
		const { start, end } = input.footer;
		// Each side takes what it needs; when both don't fit, the longer one gives way.
		const available = SLIDER.width - (start ? LEAD : 0) - (end ? LEAD : 0) - (start && end ? 10 : 0);
		const natural = (entry: FooterItem | undefined) => (entry ? textWidth(entry.text, 15) : 0);
		const startRoom = natural(start) + natural(end) <= available ? natural(start) : Math.max(available / 2, available - natural(end));
		const item = (entry: FooterItem, side: "start" | "end") => {
			const text = fit(entry.text, side === "start" ? startRoom : available - Math.min(startRoom, natural(start)), 15);
			const width = textWidth(text, 15);
			const x = side === "start" ? SLIDER.x + LEAD : SLIDER.x + SLIDER.width - width;
			parts.push(entry.mark(x - LEAD, 70, 20));
			const fill = entry.paint === undefined ? "#FFFFFF" : paintFill(entry.paint, `slider-footer-${side}`, x, x + width, parts);
			parts.push(svgText(text, x, 85, 15, 600, fill, entry.paint === undefined ? ` fill-opacity=".5"` : ""));
		};
		if (start) item(start, "start");
		if (end) item(end, "end");
	}
	else {
		const half = SLIDER.width / 2 - 4;
		parts.push(svgText(fit(input.ends[0], half, 15), SLIDER.x, 85, 15, 600, "#FFFFFF", ` fill-opacity=".5"`));
		parts.push(svgText(fit(input.ends[1], half, 15), SLIDER.x + SLIDER.width, 85, 15, 600, "#FFFFFF", ` fill-opacity=".5" text-anchor="end"`));
	}
	return svgImage(200, 100, parts.join(""));
}
