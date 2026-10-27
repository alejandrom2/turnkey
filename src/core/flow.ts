/**
 * The Flow strip background: one wide picture across a run of adjacent dials, each dial showing its 200 px slice.
 * Runs group this plugin's dials by device into adjacent columns; a gap (an empty dial or another plugin's) breaks a run.
 */
export type DialPlace = { id: string; device: string; column: number };
export type Run = { length: number; position: number };

export function dialRuns(dials: readonly DialPlace[]): Map<string, Run> {
	const runs = new Map<string, Run>();
	const byDevice = new Map<string, DialPlace[]>();
	for (const dial of dials) byDevice.set(dial.device, [...(byDevice.get(dial.device) ?? []), dial]);
	for (const placed of byDevice.values()) {
		const sorted = [...placed].sort((a, b) => a.column - b.column);
		let start = 0;
		for (let index = 1; index <= sorted.length; index++) {
			if (index < sorted.length && sorted[index].column === sorted[index - 1].column + 1) continue;
			const run = sorted.slice(start, index);
			run.forEach((dial, position) => runs.set(dial.id, { length: run.length, position }));
			start = index;
		}
	}
	return runs;
}

const WIDTH = 200;
const HEIGHT = 100;

/** A smooth wave across `width`: a cubic per half period, so neighboring slices meet without a seam. */
function wave(width: number, y: number, amplitude: number, period: number, phase: number): string {
	const half = period / 2;
	let x = -phase - period;
	let up = true;
	let path = `M${x} ${y}`;
	while (x < width + period) {
		const peak = up ? y - amplitude : y + amplitude;
		path += ` C${+(x + half * 0.36).toFixed(1)} ${peak} ${+(x + half * 0.64).toFixed(1)} ${peak} ${+(x + half).toFixed(1)} ${y}`;
		x += half;
		up = !up;
	}
	return path;
}

/**
 * Dial `run.position`'s slice of the Flow picture for a run of `run.length` dials: a dark blue-violet field with two
 * soft ribbons in T3 Code's accent running its whole width. Gradients only, no filters.
 */
export function flowArt(run: Run): string {
	const width = WIDTH * Math.max(1, run.length);
	const ribbon = (id: string, from: string, to: string) =>
		`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="0"><stop offset="0" stop-color="${from}"/><stop offset=".5" stop-color="${to}"/><stop offset="1" stop-color="${from}"/></linearGradient>`;
	const glow = (id: string, color: string, cx: number, cy: number, r: number, opacity: number) =>
		`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
	const defs =
		`<defs><linearGradient id="flow-field" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="${HEIGHT}"><stop offset="0" stop-color="#0C1222"/><stop offset=".55" stop-color="#14122A"/><stop offset="1" stop-color="#0E1A24"/></linearGradient>` +
		ribbon("flow-a", "#5B8CFF", "#8B6CF6") +
		ribbon("flow-b", "#2BB3A3", "#5B8CFF") +
		glow("flow-low", "#5B8CFF", width * 0.22, HEIGHT * 1.25, Math.max(170, width * 0.4), 0.26) +
		glow("flow-high", "#8B6CF6", width * 0.82, -HEIGHT * 0.2, Math.max(150, width * 0.32), 0.16) +
		`</defs>`;
	const body =
		`<rect width="${width}" height="${HEIGHT}" fill="url(#flow-field)"/><rect width="${width}" height="${HEIGHT}" fill="url(#flow-low)"/><rect width="${width}" height="${HEIGHT}" fill="url(#flow-high)"/>` +
		`<path d="${wave(width, 74, 15, 520, 60)}" fill="none" stroke="url(#flow-a)" stroke-width="34" stroke-opacity=".16" stroke-linecap="round"/>` +
		`<path d="${wave(width, 87, 8, 300, 150)}" fill="none" stroke="url(#flow-b)" stroke-width="9" stroke-opacity=".28" stroke-linecap="round"/>` +
		`<path d="${wave(width, 70, 12, 520, 60)}" fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-opacity=".14"/>`;
	return `${defs}<g transform="translate(${-run.position * WIDTH} 0)">${body}</g>`;
}
