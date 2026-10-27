/**
 * The Limits and Usage faces: a black key with a small label top-left, one big figure, two gray lines and a bar up
 * the right edge; on the strip, the label and its detail on the left, the figure on the right with its bar under it.
 */
import { COLORS, fitSize, type MarkPainter, svgDataUrl, svgText, textWidth } from "./render.js";
import { fit } from "./slider.js";

export type GaugeInput = {
	/** A provider mark before the label. */
	mark?: MarkPainter;
	label: string;
	value: string;
	/** Up to two gray lines under the figure; a line can take its own color. */
	lines?: (string | { text: string; color: string })[];
	/** How full the bar is, 0 to 1; no bar when undefined. */
	fill?: number;
	/** A tick on the bar where even pace would be, 0 to 1. */
	marker?: number;
	/** The figures are stale or loading: drawn faded. */
	dim?: boolean;
};

const unit = (value: number) => Math.max(0, Math.min(1, value));
/** `textWidth` measures weight 600; the bold figures run about a tenth wider. */
const BOLD = 0.88;
const lineOf = (line: string | { text: string; color: string }) => (typeof line === "string" ? { text: line, color: COLORS.muted } : line);

const KEY_BAR = { x: 120, y: 16, width: 10, height: 112 } as const;

export function renderGaugeKey(input: GaugeInput): string {
	const bar = input.fill !== undefined;
	const right = bar ? KEY_BAR.x - 8 : 130;
	const labelX = input.mark ? 40 : 15;
	const parts = [`<rect width="144" height="144" fill="#000000"/>`];
	if (input.mark) parts.push(input.mark(15, 15, 19));
	parts.push(svgText(fit(input.label, right - labelX, 16), labelX, 30, 16, 600, COLORS.text));
	const room = (right - 15) * BOLD;
	const size = fitSize(input.value, room, [44, 38, 32, 26, 22]);
	const figure: string[] = [svgText(fit(input.value, room, size), 15, 86, size, 700, "#FFFFFF")];
	if (bar) {
		const { x, y, width, height } = KEY_BAR;
		const filled = Math.round(height * unit(input.fill!));
		figure.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${width / 2}" fill="#FFFFFF" fill-opacity=".16"/>`);
		if (filled > 0) figure.push(`<rect x="${x}" y="${y + height - filled}" width="${width}" height="${filled}" rx="${width / 2}" fill="#FFFFFF"/>`);
		if (input.marker !== undefined) {
			const at = Math.round(y + height * (1 - unit(input.marker)));
			figure.push(`<rect x="${x - 4}" y="${at - 1}" width="${width + 8}" height="2" rx="1" fill="${COLORS.muted}"/>`);
		}
	}
	parts.push(input.dim ? `<g opacity=".45">${figure.join("")}</g>` : figure.join(""));
	(input.lines ?? []).slice(0, 2).forEach((raw, index) => {
		const line = lineOf(raw);
		parts.push(svgText(fit(line.text, right - 15, 15), 15, 110 + index * 19, 15, 600, line.color));
	});
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`);
}

export type GaugeStripInput = GaugeInput & {
	/** The bottom row, left: whose figures these are. */
	footer?: string;
	/** The bottom row, right: where the dial is (`2/5`). */
	position?: string;
	/**
	 * For figures too wide for the right column (money): the figure goes under the label with the first line beside
	 * it, the bar runs the full width, and the second line takes the footer's place.
	 */
	stacked?: boolean;
};

type Bar = { x: number; y: number; width: number; height: number };

function stripBar(bar: Bar, fill: number, marker: number | undefined): string {
	const { x, y, width, height } = bar;
	const filled = Math.round(width * unit(fill));
	const parts = [`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#FFFFFF" fill-opacity=".16"/>`];
	if (filled > 0) parts.push(`<rect x="${x}" y="${y}" width="${filled}" height="${height}" rx="${height / 2}" fill="#FFFFFF"/>`);
	if (marker !== undefined) parts.push(`<rect x="${Math.round(x + width * unit(marker)) - 1}" y="${y - 3}" width="2" height="${height + 6}" rx="1" fill="${COLORS.muted}"/>`);
	return parts.join("");
}

export function gaugeStripArt(input: GaugeStripInput): string {
	const parts: string[] = [];
	const labelX = input.mark ? 36 : 12;
	if (input.mark) parts.push(input.mark(12, 11, 19));
	// The label row sits above the figure, so it may run the full width.
	parts.push(svgText(fit(input.label, 188 - labelX, 16), labelX, 26, 16, 650, COLORS.text));
	const [detail, more] = (input.lines ?? []).map(lineOf);
	const position = input.position ?? "";
	const figure: string[] = [];
	let footer: { text: string; color: string } | undefined = input.footer === undefined ? undefined : { text: input.footer, color: COLORS.muted };
	if (input.stacked) {
		const size = fitSize(input.value, 112 * BOLD, [28, 24, 20, 17]);
		const value = fit(input.value, 112 * BOLD, size);
		figure.push(svgText(value, 12, 56, size, 700, "#FFFFFF"));
		if (detail) {
			// Beside a wide figure the line keeps its first word: "51.2M tokens" becomes "51.2M".
			const room = 176 - textWidth(value, size) / BOLD - 10;
			const text = textWidth(detail.text, 14) <= room ? detail.text : (detail.text.split(" ")[0] ?? "");
			parts.push(svgText(fit(text, Math.max(0, room), 14), 188, 56, 14, 600, detail.color, ` text-anchor="end"`));
		}
		if (input.fill !== undefined) figure.push(stripBar({ x: 12, y: 66, width: 176, height: 6 }, input.fill, input.marker));
		footer = more ?? footer;
	} else {
		if (detail) parts.push(svgText(fit(detail.text, 96, 14), 12, 49, 14, 600, detail.color));
		if (more) parts.push(svgText(fit(more.text, 96, 14), 12, 68, 14, 600, more.color));
		const size = fitSize(input.value, 80 * BOLD, [30, 26, 22, 18]);
		figure.push(svgText(fit(input.value, 84 * BOLD, size), 188, 54, size, 700, "#FFFFFF", ` text-anchor="end"`));
		if (input.fill !== undefined) figure.push(stripBar({ x: 112, y: 66, width: 76, height: 6 }, input.fill, input.marker));
	}
	parts.push(input.dim ? `<g opacity=".45">${figure.join("")}</g>` : figure.join(""));
	if (position) parts.push(svgText(position, 188, 88, 13, 600, COLORS.muted, ` text-anchor="end"`));
	if (footer) parts.push(svgText(fit(footer.text, position ? 140 : 176, 13), 12, 88, 13, 600, footer.color));
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`);
}
