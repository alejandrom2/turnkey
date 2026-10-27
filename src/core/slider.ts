/**
 * The Power dial's slider face, drawn over the strip's background: the value top-left with small badges top-right,
 * a stepped track with the current value filled and a previewed one as a hollow thumb, and what the ends mean (or
 * what pressing does) along the bottom.
 */
import { COLORS, escapeXml, FONT_FAMILY, type MarkPainter, type Paint, paintFill, svgDataUrl, svgText, textWidth } from "./render.js";

export type SliderInput = {
	label: string;
	labelColor?: string;
	/** After the label, dimmed unless painted: the model's effort, in the spectrum while Ultrathink is armed. */
	suffix?: { text: string; paint?: Paint };
	/** How many stops the track has, at least two. */
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
	footer?: { mark: MarkPainter; text: string; color?: string };
	/** Replaces the ends: what pressing does, or why the dial can't act. */
	note?: { text: string; color?: string };
	/** Up to two 20 px badges at the top right, rightmost first. */
	badges?: MarkPainter[];
	/** A 20 px mark before the label: the provider, effort or mode icon. */
	lead?: MarkPainter;
	/** Dims the track: the dial can't act. */
	dim?: boolean;
	/** How far an overflowing label has scrolled left, in px. */
	labelOffset?: number;
};

export const SLIDER = { x: 12, width: 176, y: 41, height: 18, inset: 12 } as const;

/** The center of stop `index` of `stops` along the track. */
export const stopX = (index: number, stops: number): number =>
	+(SLIDER.x + SLIDER.inset + (index * (SLIDER.width - 2 * SLIDER.inset)) / Math.max(1, stops - 1)).toFixed(2);

const BADGE = 20;

/** `text` cut with an ellipsis to fit `width` at `size`. */
function fit(text: string, width: number, size: number): string {
	if (textWidth(text, size) <= width) return text;
	const chars = [...text];
	while (chars.length > 1 && textWidth(`${chars.join("")}…`, size) > width) chars.pop();
	return `${chars.join("").trimEnd()}…`;
}

/** Provider labels can carry stray or doubled spaces; the label keeps whitespace as written, so collapse them. */
const tidy = (text: string) => text.replace(/\s+/g, " ").trim();

/** The label line as the marquee measures it. */
export const sliderLabelText = (input: Pick<SliderInput, "label" | "suffix">): string => (input.suffix ? `${input.label} ${input.suffix.text}` : input.label);

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
	const stops = Math.max(2, input.stops);
	const cy = SLIDER.y + SLIDER.height / 2;
	const badges = (input.badges ?? []).slice(0, 2);
	const parts: string[] = [];
	badges.forEach((badge, index) => parts.push(badge(SLIDER.x + SLIDER.width - BADGE - index * (BADGE + 6), 9, BADGE)));

	const labelRoom = sliderLabelSlot(input).width;
	const start = SLIDER.x + (input.lead ? LEAD : 0);
	if (input.lead) parts.push(input.lead(SLIDER.x, 9, BADGE));
	const labelColor = input.labelColor ?? COLORS.text;
	const overflow = textWidth(sliderLabelText(input), 16) - labelRoom;
	const suffix = input.suffix;
	const suffixFill = suffix?.paint === undefined ? `fill="#FFFFFF" fill-opacity=".5"` : `fill="${paintFill(suffix.paint, "slider-suffix", start, start + labelRoom, parts)}"`;
	const label = (x: number, extra = "") => {
		if (suffix === undefined) return `<g${extra}>${svgText(input.label, x, 26, 16, 650, labelColor)}</g>`;
		// One text run, as Elgato's slider draws it, so the space between name and effort comes from the font itself.
		return `<g${extra}><text x="${x}" y="26" font-family="${FONT_FAMILY}" font-size="16" font-weight="650" xml:space="preserve"><tspan fill="${labelColor}">${escapeXml(tidy(input.label))} </tspan><tspan ${suffixFill}>${escapeXml(tidy(suffix.text))}</tspan></text></g>`;
	};
	if (overflow > 0) {
		const end = start + labelRoom;
		const offset = Math.min(Math.max(0, input.labelOffset ?? 0), overflow + 4);
		// At rest the tail fades out; while it scrolls the label is clipped to its room instead.
		const shape =
			offset === 0
				? `<linearGradient id="slider-label-fade" gradientUnits="userSpaceOnUse" x1="${end - 22}" y1="0" x2="${end}" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient><mask id="slider-label" maskUnits="userSpaceOnUse" x="0" y="0" width="200" height="34"><rect width="200" height="34" fill="url(#slider-label-fade)"/></mask>`
				: `<clipPath id="slider-label"><rect x="${start}" y="0" width="${labelRoom}" height="34"/></clipPath>`;
		parts.push(`<defs>${shape}</defs>`, label(+(start - offset).toFixed(1), offset === 0 ? ` mask="url(#slider-label)"` : ` clip-path="url(#slider-label)"`));
	} else parts.push(label(start));

	const track: string[] = [`<rect x="${SLIDER.x}" y="${SLIDER.y}" width="${SLIDER.width}" height="${SLIDER.height}" rx="${SLIDER.height / 2}" fill="#FFFFFF" fill-opacity=".1"/>`];
	const current = input.current >= 0 && input.current < stops ? input.current : undefined;
	if (current !== undefined) {
		const fill = paintFill(input.fill ?? COLORS.accent, "slider-fill", SLIDER.x, SLIDER.x + SLIDER.width, track);
		track.push(`<rect x="${SLIDER.x}" y="${SLIDER.y}" width="${+(stopX(current, stops) - SLIDER.x + SLIDER.height / 2).toFixed(2)}" height="${SLIDER.height}" rx="${SLIDER.height / 2}" fill="${fill}"/>`);
	}
	for (let index = 0; index < stops; index++) track.push(`<circle cx="${stopX(index, stops)}" cy="${cy}" r="2" fill="#FFFFFF" fill-opacity="${current !== undefined && index <= current ? ".5" : ".28"}"/>`);
	if (current !== undefined) track.push(`<circle cx="${stopX(current, stops)}" cy="${cy}" r="11" fill="#FFFFFF"/>`);
	const preview = input.preview;
	if (preview !== undefined && preview >= 0 && preview < stops && preview !== current) {
		track.push(`<circle cx="${stopX(preview, stops)}" cy="${cy}" r="9.5" fill="#111111" fill-opacity=".55" stroke="#FFFFFF" stroke-width="2.5"/>`);
	}
	parts.push(input.dim ? `<g opacity=".45">${track.join("")}</g>` : track.join(""));

	if (input.note) parts.push(svgText(fit(input.note.text, SLIDER.width, 15), SLIDER.x, 85, 15, 600, input.note.color ?? COLORS.muted));
	else if (input.footer) {
		parts.push(input.footer.mark(SLIDER.x, 70, 20));
		parts.push(svgText(fit(input.footer.text, SLIDER.width - LEAD, 15), SLIDER.x + LEAD, 85, 15, 600, input.footer.color ?? "#FFFFFF", input.footer.color ? "" : ` fill-opacity=".5"`));
	}
	else {
		const half = SLIDER.width / 2 - 4;
		parts.push(svgText(fit(input.ends[0], half, 15), SLIDER.x, 85, 15, 600, "#FFFFFF", ` fill-opacity=".5"`));
		parts.push(svgText(fit(input.ends[1], half, 15), SLIDER.x + SLIDER.width, 85, 15, 600, "#FFFFFF", ` fill-opacity=".5" text-anchor="end"`));
	}
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`);
}
