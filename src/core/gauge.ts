/**
 * The Limits and Usage faces: a black key with a small label top-left, one big figure, two gray lines and a bar up
 * the right edge; on the strip, the label and its detail on the left, the figure on the right with its bar under it.
 */
import { COLORS, fitSize, type MarkPainter, svgDataUrl, svgText } from "./render.js";
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
const lineOf = (line: string | { text: string; color: string }) => (typeof line === "string" ? { text: line, color: COLORS.muted } : line);

const KEY_BAR = { x: 120, y: 16, width: 10, height: 112 } as const;

export function renderGaugeKey(input: GaugeInput): string {
	const bar = input.fill !== undefined;
	const right = bar ? KEY_BAR.x - 8 : 130;
	const labelX = input.mark ? 40 : 15;
	const parts = [`<rect width="144" height="144" fill="#000000"/>`];
	if (input.mark) parts.push(input.mark(15, 15, 19));
	parts.push(svgText(fit(input.label, right - labelX, 16), labelX, 30, 16, 600, COLORS.text));
	const size = fitSize(input.value, right - 15, [44, 38, 32, 26, 22]);
	const figure: string[] = [svgText(fit(input.value, right - 15, size), 15, 86, size, 700, "#FFFFFF")];
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
};

const STRIP_BAR = { x: 112, y: 66, width: 76, height: 6 } as const;

export function gaugeStripArt(input: GaugeStripInput): string {
	const parts: string[] = [];
	const labelX = input.mark ? 36 : 12;
	if (input.mark) parts.push(input.mark(12, 11, 19));
	parts.push(svgText(fit(input.label, 104 - labelX, 16), labelX, 26, 16, 650, COLORS.text));
	const [detail, more] = (input.lines ?? []).map(lineOf);
	if (detail) parts.push(svgText(fit(detail.text, 96, 14), 12, 49, 14, 600, detail.color));
	if (more) parts.push(svgText(fit(more.text, 96, 14), 12, 68, 14, 600, more.color));
	const size = fitSize(input.value, 80, [30, 26, 22, 18]);
	const figure: string[] = [svgText(fit(input.value, 84, size), 188, 54, size, 700, "#FFFFFF", ` text-anchor="end"`)];
	if (input.fill !== undefined) {
		const { x, y, width, height } = STRIP_BAR;
		const filled = Math.round(width * unit(input.fill));
		figure.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#FFFFFF" fill-opacity=".16"/>`);
		if (filled > 0) figure.push(`<rect x="${x}" y="${y}" width="${filled}" height="${height}" rx="${height / 2}" fill="#FFFFFF"/>`);
		if (input.marker !== undefined) {
			const at = Math.round(x + width * unit(input.marker));
			figure.push(`<rect x="${at - 1}" y="${y - 3}" width="2" height="${height + 6}" rx="1" fill="${COLORS.muted}"/>`);
		}
	}
	parts.push(input.dim ? `<g opacity=".45">${figure.join("")}</g>` : figure.join(""));
	const position = input.position ?? "";
	if (position) parts.push(svgText(position, 188, 88, 13, 600, COLORS.muted, ` text-anchor="end"`));
	if (input.footer) parts.push(svgText(fit(input.footer, position ? 140 : 176, 13), 12, 88, 13, 600, COLORS.muted));
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${parts.join("")}</svg>`);
}
