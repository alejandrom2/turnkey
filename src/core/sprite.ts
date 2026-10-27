/**
 * The idle pet's art: a small robot, our own, drawn as merged pixel rows. Swap this module to change the pet; the
 * scheduler and placement only read `SPRITE` and call `spriteArt`.
 */
import { COLORS } from "./render.js";

const SCALE = 2;
const PALETTE: Record<string, string> = { w: COLORS.text, g: COLORS.muted, d: COLORS.dim, a: COLORS.accent };

const BODY = [
	".....a......",
	".....d......",
	"..wwwwwwww..",
	"..wddddddw..",
	"..wdddadaw..",
	"..wwwwwwww..",
	"...gggggg...",
	"..dgwwwwgd..",
	"..dggaaggd..",
	"...gggggg...",
];
/** Two walking steps: a stride, then the legs passing. */
const LEGS = [
	["...dd..dd...", "..dd....dd.."],
	["....dddd....", "....dddd...."],
];

const COLUMNS = BODY[0]!.length;
export const SPRITE = { width: COLUMNS * SCALE, height: (BODY.length + LEGS[0]!.length) * SCALE } as const;

/** One frame's rows as rects, each horizontal run of a color merged into one. */
function rows(frame: number, facing: 1 | -1): string {
	const grid = [...BODY, ...LEGS[frame % LEGS.length]!];
	let out = "";
	grid.forEach((line, y) => {
		const cells = facing === 1 ? line : [...line].reverse().join("");
		for (let x = 0; x < cells.length; ) {
			const color = PALETTE[cells[x]!];
			let end = x + 1;
			while (end < cells.length && cells[end] === cells[x]) end++;
			if (color) out += `<rect x="${x * SCALE}" y="${y * SCALE}" width="${(end - x) * SCALE}" height="${SCALE}" fill="${color}"/>`;
			x = end;
		}
	});
	return out;
}

const FRAMES = { 1: LEGS.map((_, frame) => rows(frame, 1)), [-1]: LEGS.map((_, frame) => rows(frame, -1)) } as const;

/** The robot with its top-left corner at (`x`, `y`) on a strip, in walking step `frame`, facing right (1) or left (-1). */
export const spriteArt = (x: number, y: number, frame: number, facing: 1 | -1): string =>
	`<g transform="translate(${x} ${y})" shape-rendering="crispEdges">${FRAMES[facing][frame % LEGS.length]}</g>`;
