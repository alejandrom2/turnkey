import type { DeckState } from "./board.js";
import type { Run } from "./flow.js";
import { LUCIDE } from "./icons.js";
import type { RuntimeMode } from "./t3/shell.js";

/** Palette follows the native Stream Deck agent style: flat near-black keys, white line glyphs, one status accent. */
export const COLORS = {
	key: "#111111",
	keyActive: "#292929",
	text: "#F5F7FB",
	muted: "#8A8F98",
	done: "#40C977",
	error: "#FF6764",
	/** T3 Code's Pending Approval amber and Awaiting Input indigo (Tailwind amber-300, indigo-300). */
	attention: "#FCD34D",
	question: "#A5B4FC",
	accent: "#5B8CFF",
	unread: "#007BE5",
	dim: "#3A3D44",
	/** Secondary strip text: a detail line, the next row, a far tile's name. */
	secondary: "#B8BCC6",
	/** Dimmed text: a thread key's elapsed time, the strip's other thread rows. */
	faint: "#9A9A9A",
	/** What a white provider mark becomes on a fill, so a white thumb stands out. */
	neutral: "#8E9199",
	/** T3 Code's card: the strip's background. */
	card: "#121212",
} as const;

export const STATE_COLOR: Record<DeckState, string> = {
	approval: COLORS.attention,
	question: COLORS.question,
	running: COLORS.accent,
	queued: COLORS.muted,
	done: COLORS.done,
	failed: COLORS.error,
	stopped: COLORS.muted,
	idle: COLORS.muted,
};

/** T3 Code's Lucide icons on a 24-unit grid; Stop is filled like T3's composer stop button. */
export const GLYPHS = {
	...LUCIDE,
	stop: `<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" stroke="none"/>`,
	/** Lucide's play, filled: Stop's Resume face. */
	play: `<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>`,
	/** Lucide's circle-x, Deny's counterpart to the circled check. */
	denyCircle: `<circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />`,
	/** Lucide's check and message-circle: a thread key's done and idle marks. */
	checkBare: `<path d="M20 6 9 17l-5-5" />`,
	chatRound: `<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />`,
	/** Lucide's chart-no-axes-column, T3 Code's Usage icon. */
	usage: `<path d="M5 21v-6" /><path d="M12 21V3" /><path d="M19 21V9" />`,
	/** Lucide's zap, filled: Speed while fast. */
	speedFilled: `<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" fill="currentColor" />`,
} as const;
export type GlyphName = keyof typeof GLYPHS;

export const STATE_GLYPH: Record<DeckState, GlyphName> = {
	approval: "shield",
	question: "question",
	running: "running",
	queued: "clock",
	done: "check",
	failed: "error",
	stopped: "pause",
	idle: "idle",
};

/** Thread keys follow the activity-key convention: spinner while working, clock while waiting on someone. */
export const THREAD_GLYPH: Record<DeckState, GlyphName> = {
	approval: "clock",
	question: "clock",
	running: "spinner",
	queued: "clock",
	done: "checkBare",
	failed: "error",
	stopped: "pause",
	idle: "chatRound",
};

/** T3 Code's access-mode icons. */
export const MODE_GLYPH: Record<RuntimeMode, GlyphName> = {
	"approval-required": "modeSupervised",
	"auto-accept-edits": "modeAutoAcceptEdits",
	auto: "modeAuto",
	"full-access": "modeFullAccess",
};

/**
 * T3 Code's `.ultrathink-frame` spectrum (apps/web/src/index.css), its saturate(.82) brightness(.92) filter baked into
 * the stops because Stream Deck's SVG renderer can't be relied on for filters.
 */
export const SPECTRUM: Stops = [
	[0, "#D76868"],
	[0.18, "#D49324"],
	[0.36, "#33AE61"],
	[0.54, "#28A396"],
	[0.72, "#4176CE"],
	[0.9, "#C54986"],
	[1, "#D76868"],
];

/** How effort and models are colored (Advanced → Colors): gradients by default. */
export type MaxEffortStyle = "gradient" | "solid" | "model" | "off";
export const maxEffortStyle = (value: unknown): MaxEffortStyle => (value === "solid" || value === "model" || value === "off" ? value : "gradient");

/** Color stops as data: offset (0 to 1) and color. */
export type Stops = readonly (readonly [number, string])[];
/** A fill: one color, or a gradient laid along the shape's run. */
export type Paint = string | { gradient: Stops };

const MAX_VIOLET = "#AD7BF9";
const EFFORT_GRADIENT: Stops = [
	[0, "#648FFD"],
	[0.55, MAX_VIOLET],
	[1, "#8B84FB"],
];

const hex = (color: string) => [1, 3, 5].map((at) => Number.parseInt(color.slice(at, at + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
const mix = (a: string, b: string, t: number) => toHex(hex(a).map((value, index) => value + (hex(b)[index]! - value) * t));

/** `color` with its hue turned `degrees` toward violet (270°) along the shorter way, and its saturation raised a little. */
function towardViolet(color: string, degrees: number): string {
	const [r, g, b] = hex(color).map((value) => value / 255) as [number, number, number];
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const light = (max + min) / 2;
	const chroma = max - min;
	if (chroma === 0) return color;
	const saturation = chroma / (1 - Math.abs(2 * light - 1));
	const hue = 60 * (max === r ? ((g - b) / chroma + 6) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4);
	const delta = ((270 - hue + 540) % 360) - 180;
	const turned = (hue + Math.sign(delta) * Math.min(Math.abs(delta), degrees) + 360) % 360;
	const s = Math.min(1, saturation * 1.1);
	const c = (1 - Math.abs(2 * light - 1)) * s;
	const x = c * (1 - Math.abs(((turned / 60) % 2) - 1));
	const m = light - c / 2;
	const [r1, g1, b1] = turned < 60 ? [c, x, 0] : turned < 120 ? [x, c, 0] : turned < 180 ? [0, c, x] : turned < 240 ? [0, x, c] : turned < 300 ? [x, 0, c] : [c, 0, x];
	return toHex([r1 + m, g1 + m, b1 + m].map((value) => value * 255));
}

/** The color `t` (0 to 1) of the way along `stops`. */
export function sampleStops(stops: Stops, t: number): string {
	const at = Math.max(0, Math.min(1, t));
	const after = stops.findIndex(([offset]) => offset >= at);
	if (after <= 0) return stops[Math.max(0, after)]![1];
	const [from, a] = stops[after - 1]!;
	const [to, b] = stops[after]!;
	return mix(a, b, (at - from) / (to - from || 1));
}

/** Any provider's gradient: a light tint of its color into the color itself; gray for white marks. */
export const providerGradient = (color: string | undefined): Stops => [
	[0, mix(color ?? COLORS.neutral, "#FFFFFF", 0.45)],
	[1, color ?? COLORS.neutral],
];

/**
 * The effort ladder in a model's own color: a light tint up to the color, turning toward violet at the top.
 * Without a color (white marks) it is blue to violet.
 */
export const effortGradient = (modelColor: string | undefined): Stops =>
	modelColor === undefined
		? EFFORT_GRADIENT
		: [
				[0, mix(modelColor, "#FFFFFF", 0.5)],
				[0.55, modelColor],
				[1, towardViolet(modelColor, 40)],
			];

/** An effort level `t` of the way up its model's ladder: its text color and the track's fill; undefined leaves them as usual. */
export function effortTone(style: MaxEffortStyle, t: number, top: boolean, modelColor: string | undefined): { text: string; fill: Paint } | undefined {
	switch (style) {
		case "gradient": {
			const gradient = effortGradient(modelColor);
			return { text: sampleStops(gradient, t), fill: { gradient } };
		}
		case "solid":
			return top ? { text: MAX_VIOLET, fill: MAX_VIOLET } : undefined;
		case "model":
			return top && modelColor !== undefined ? { text: modelColor, fill: modelColor } : undefined;
		case "off":
			return undefined;
	}
}

/** Access modes run from asking first (T3 blue) to hands-off (the amber Full access already wears). */
const ACCESS_GRADIENT: Stops = [
	[0, COLORS.accent],
	// Through violet: blue and amber alone mix to gray in the middle.
	[0.5, MAX_VIOLET],
	[1, COLORS.attention],
];

/** An access mode `t` of the way from the most supervised to the most hands-off: its text color and the track's fill. */
export const accessTone = (t: number): { text: string; fill: Paint } => ({ text: sampleStops(ACCESS_GRADIENT, t), fill: { gradient: ACCESS_GRADIENT } });

/** A model's track fill: its provider's gradient, or its color; gray for white marks, so the white thumb stands out. */
export const modelFill = (style: MaxEffortStyle, color: string | undefined): Paint => (style === "gradient" ? { gradient: providerGradient(color) } : (color ?? COLORS.neutral));

const gradientStops = (stops: Stops): string => stops.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join("");

/** `paint` as a fill attribute value, defining its gradient (`id`, along x1→x2) into `defs` when it has one. */
export function paintFill(paint: Paint, id: string, x1: number, x2: number, defs: string[]): string {
	if (typeof paint === "string") return paint;
	defs.push(`<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0">${gradientStops(paint.gradient)}</linearGradient></defs>`);
	return `url(#${id})`;
}

/** A static 120° spectrum border, like T3 Code's composer while Ultrathink is on. */
function ultrathinkFrame(width: number, height: number, radius: number, stroke: number): string {
	const inset = stroke / 2;
	return (
		`<defs><linearGradient id="ultrathink" gradientUnits="userSpaceOnUse" x1="0" y1="${height * 0.21}" x2="${width}" y2="${height * 0.79}">${gradientStops(SPECTRUM)}</linearGradient></defs>` +
		`<rect x="${inset}" y="${inset}" width="${width - stroke}" height="${height - stroke}" rx="${radius}" fill="none" stroke="url(#ultrathink)" stroke-width="${stroke}"/>`
	);
}

/** One stack for macOS and Linux, so the bundled profiles come out the same on either build machine. */
export function fontFamily(platform: NodeJS.Platform = process.platform): string {
	if (platform === "win32") return `'Segoe UI Variable','Segoe UI',sans-serif`;
	return `-apple-system,BlinkMacSystemFont,'SF Pro Display','Inter','Noto Sans','DejaVu Sans',sans-serif`;
}

const FONT_FAMILY = fontFamily();

export const escapeXml = (text: string) =>
	text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export const svgMarkup = (width: number, height: number, body: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>`;

/** A `width` × `height` picture as the data URL Stream Deck's setImage and setFeedback take. */
export const svgImage = (width: number, height: number, body: string) =>
	`data:image/svg+xml;base64,${Buffer.from(svgMarkup(width, height, body)).toString("base64")}`;

const keySvg = (body: string) => svgImage(144, 144, body);

export function glyph(name: GlyphName, x: number, y: number, size: number, color: string = COLORS.text, strokeWidth = 2, rotate = 0): string {
	const scale = size / 24;
	return `<g transform="translate(${x} ${y}) scale(${scale})${rotate ? ` rotate(${rotate} 12 12)` : ""}" fill="none" stroke="${color}" color="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`;
}

const NARROW = new Set("ilI1|.,:;'!`");
const WIDE = new Set("MW@#%&");
/** Hangul, kana, CJK ideographs and full-width forms: a full em each. */
const FULL_WIDTH = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/;

/** Bold (700 and up) runs about a tenth wider than 600. */
const BOLD = 0.88;

/** Approximate advance of `text` in px for the system UI font at weight 600, or bold from 700. */
export function textWidth(text: string, fontSize: number, weight = 600): number {
	let em = 0;
	for (const char of text) {
		if (char === " ") em += 0.33;
		else if (FULL_WIDTH.test(char)) em += 1;
		else if (NARROW.has(char)) em += 0.3;
		else if (WIDE.has(char)) em += 0.85;
		else if (char >= "0" && char <= "9") em += 0.58;
		else if (char >= "A" && char <= "Z") em += 0.64;
		else em += 0.56;
	}
	return weight >= 700 ? (em * fontSize) / BOLD : em * fontSize;
}

/** `text` cut by character with an ellipsis to fit `width`. */
export function fit(text: string, width: number, size: number, weight?: number): string {
	if (textWidth(text, size, weight) <= width) return text;
	const chars = [...text];
	while (chars.length > 1 && textWidth(`${chars.join("")}…`, size, weight) > width) chars.pop();
	return `${chars.join("").trimEnd()}…`;
}

/** Longest character prefix of `text` that fits `maxWidth`, at least one character. */
function fitChars(text: string, maxWidth: number, fontSize: number): string {
	const chars = [...text];
	let end = 1;
	while (end < chars.length && textWidth(chars.slice(0, end + 1).join(""), fontSize) <= maxWidth) end++;
	return chars.slice(0, end).join("");
}

/** Wrapped lines; `overflowed` when text was left over, `cut` lists lines that end mid-word, both drawn faded. */
type Wrapped = { lines: string[]; overflowed: boolean; cut?: number[] };

/**
 * Greedy word wrap by measured width. A word wider than a line breaks after a hyphen that fits; otherwise it breaks
 * by character, or with `cut` it fills the line and its rest is dropped (the line fades). When text is left over,
 * the last line is filled to the edge and `overflowed` is set so the caller can fade it.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number, options: { cut?: boolean } = {}): Wrapped {
	let rest = text.trim().replace(/\s+/g, " ");
	const lines: string[] = [];
	const cut: number[] = [];
	while (rest && lines.length < maxLines) {
		if (textWidth(rest, fontSize) <= maxWidth) {
			lines.push(rest);
			rest = "";
			break;
		}
		const isLast = lines.length === maxLines - 1;
		let line = "";
		if (!isLast) {
			for (let space = rest.indexOf(" "); space !== -1; space = rest.indexOf(" ", space + 1)) {
				const candidate = rest.slice(0, space);
				if (textWidth(candidate, fontSize) > maxWidth) break;
				line = candidate;
			}
			if (!line) {
				const word = rest.split(" ")[0];
				for (let hyphen = word.lastIndexOf("-", word.length - 2); hyphen > 0; hyphen = word.lastIndexOf("-", hyphen - 1)) {
					if (textWidth(word.slice(0, hyphen + 1), fontSize) <= maxWidth) {
						line = word.slice(0, hyphen + 1);
						break;
					}
				}
				if (!line && options.cut) {
					cut.push(lines.length);
					lines.push(fitChars(word, maxWidth, fontSize));
					rest = rest.slice(word.length).trimStart();
					continue;
				}
			}
		}
		if (!line) line = fitChars(rest, maxWidth, fontSize).trimEnd();
		lines.push(line);
		rest = rest.slice(line.length).trimStart();
	}
	return cut.length > 0 ? { lines, overflowed: rest.length > 0, cut } : { lines, overflowed: rest.length > 0 };
}

/** The first of `sizes` at which every word of `text` fits `maxWidth`, else the smallest: a size step beats breaking a word. */
export function fitSize(text: string, maxWidth: number, sizes: readonly number[], weight?: number): number {
	const words = text.trim().split(/\s+/);
	return sizes.find((size) => words.every((word) => textWidth(word, size, weight) <= maxWidth)) ?? sizes[sizes.length - 1];
}

const FADE_OUT: Stops = [[0, "#fff"], [1, "#000"]];

/** Defines mask `id`: what it covers fades out to the right from x1 to x2, across a band of the picture. */
export const fadeMask = (id: string, x1: number, x2: number, band: { y: number; width: number; height: number }): string =>
	`<defs><linearGradient id="${id}-fade" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0">${gradientStops(FADE_OUT)}</linearGradient>` +
	`<mask id="${id}" maskUnits="userSpaceOnUse" x="0" y="${band.y}" width="${band.width}" height="${band.height}"><rect y="${band.y}" width="${band.width}" height="${band.height}" fill="url(#${id}-fade)"/></mask></defs>`;

type BlockOptions = { x: number; firstBaseline: number; lineHeight: number; size: number; maxWidth: number; opacity?: number; fill?: string; anchor?: "middle" };

/** Lines from `firstBaseline` down; a cut line, and an overflowed last line, fade out over the right edge of the wrap box. */
function textBlock({ lines, overflowed, cut }: Wrapped, opts: BlockOptions): string {
	const attrs = `${opts.opacity === undefined ? "" : ` fill-opacity="${opts.opacity}"`}${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""}`;
	const text = (line: string, y: number, extra = "") => svgText(line, opts.x, y, opts.size, 600, opts.fill ?? "#FFFFFF", attrs + extra);
	return lines
		.map((line, index) => {
			const y = opts.firstBaseline + index * opts.lineHeight;
			const fades = cut?.includes(index) || (overflowed && index === lines.length - 1);
			if (!fades) return text(line, y);
			const end = opts.anchor === "middle" ? opts.x + opts.maxWidth / 2 : opts.x + opts.maxWidth;
			return fadeMask(`fade${y}`, end - 28, end, { y: y - opts.size, width: 144, height: opts.size * 1.6 }) + text(line, y, ` mask="url(#fade${y})"`);
		})
		.join("");
}

const background = (fill: string) => `<rect width="144" height="144" fill="${fill}"/>`;
const overlay = (fill: string, opacity: number) => `<rect width="144" height="144" fill="${fill}" fill-opacity="${+opacity.toFixed(3)}"/>`;
const META = { size: 16, baseline: 31, right: 129 } as const;
const TITLE = { x: 15, firstBaseline: 82, lineHeight: 20, size: 17 } as const;
/** Title sizes a thread key tries, so one long word shrinks a step before it breaks. */
const TITLE_SIZES = [17, 15] as const;

/** How a thread key moves: the spinner's angle, and a wash opacity in place of the resting one (pulse or flash). */
export type KeyMotion = { spin?: number; wash?: number };

type ThreadKeyInput = {
	state: DeckState;
	title: string;
	/** Top-right text, usually elapsed time. A non-empty `diff` takes its place. */
	meta?: string;
	diff?: { additions: number; deletions: number };
	unseen?: boolean;
	/** True on the selected thread's key, false on the others; undefined when nothing is selected. */
	selected?: boolean;
	motion?: KeyMotion;
	/** Messages waiting in the thread's queue: a small "+2" under the meta. */
	queued?: number;
	/** Subagents running for the thread: a small bot and count beside the queue. */
	subagents?: number;
	/** The thread works in its own worktree: a small folder mark beside the state glyph. */
	worktree?: boolean;
};

/**
 * A thread's queue ("+N") and running subagents (a bot and N) as small pills, right-aligned at `right`, top at `top`.
 * `right` comes back as the left edge of the row, less a gap.
 */
export function badgeRow(queued: number | undefined, subagents: number | undefined, right: number, top: number): { svg: string; right: number } {
	const pill = (left: number, width: number) => `<rect x="${left}" y="${top}" width="${width}" height="20" rx="10" fill="#FFFFFF" fill-opacity=".14"/>`;
	let svg = "";
	if (queued !== undefined && queued > 0) {
		const label = `+${queued}`;
		const width = Math.round(textWidth(label, 14) + 14);
		svg += pill(right - width, width) + svgText(label, right - width / 2, top + 15, 14, 600, COLORS.text, ` text-anchor="middle"`);
		right -= width + 4;
	}
	if (subagents !== undefined && subagents > 0) {
		const label = String(subagents);
		const width = Math.round(textWidth(label, 14) + 32);
		svg += pill(right - width, width) + glyph("subagent", right - width + 6, top + 3, 14, COLORS.text, 2.2) + svgText(label, right - 8, top + 15, 14, 600, COLORS.text, ` text-anchor="end"`);
		right -= width + 4;
	}
	return { svg, right };
}

/** The wash and glyph color of a state that wants attention: amber approval, indigo question, red failed, green unseen done. */
export function threadTint(state: DeckState, unseen = false): string | undefined {
	if (state === "approval") return COLORS.attention;
	if (state === "question") return COLORS.question;
	if (state === "failed") return COLORS.error;
	if (state === "done" && unseen) return COLORS.done;
	return undefined;
}

/** A thread key's tile: gray, or a deep shade of what it needs (amber approval, indigo question, red failed, green unseen done). */
const THREAD_TILE = { base: "#363636", [COLORS.attention]: "#4E4114", [COLORS.question]: "#2F3360", [COLORS.error]: "#5C2328", [COLORS.done]: "#1E4A32" } as Record<string, string>;

/** Wash opacities over the tile: a selected key's white, and how far a pulse or flash brightens it. */
const WASH = { selected: 0.15, selectedTint: 0.1 } as const;
/** Titles of the keys that aren't selected. */
const UNSELECTED_OPACITY = 0.55;

/** A thread: state glyph top-left, meta top-right, up to three title lines below, tinted by what it needs. */
export function renderThreadKey(input: ThreadKeyInput): string {
	const tint = threadTint(input.state, input.unseen);
	const parts = [background(THREAD_TILE[tint ?? ""] ?? THREAD_TILE.base!)];
	const wash = input.motion?.wash;
	if (wash !== undefined) parts.push(overlay(tint ?? STATE_COLOR[input.state], wash));
	if (input.selected) parts.push(overlay("#FFFFFF", tint ? WASH.selectedTint : WASH.selected));
	const dim = input.selected === false ? UNSELECTED_OPACITY : undefined;

	const glyphColor = tint ?? COLORS.text;
	const icon = input.state === "running" ? glyph("spinner", 12, 12, 40, glyphColor, 2, input.motion?.spin ?? 0) : glyph(THREAD_GLYPH[input.state], 12, 12, 40, glyphColor);
	parts.push(dim !== undefined && !tint ? `<g opacity="${dim}">${icon}</g>` : icon);

	const diff = input.diff && (input.diff.additions > 0 || input.diff.deletions > 0) ? input.diff : undefined;
	if (diff) {
		const deletions = `-${diff.deletions}`;
		const additionsRight = Math.round(META.right - textWidth(deletions, META.size) - 8);
		parts.push(
			svgText(`+${diff.additions}`, additionsRight, META.baseline, META.size, 600, COLORS.done, ` text-anchor="end"`),
			svgText(deletions, META.right, META.baseline, META.size, 600, COLORS.error, ` text-anchor="end"`),
		);
	} else if (input.meta) {
		parts.push(svgText(input.meta, META.right, META.baseline, META.size, 600, COLORS.faint, ` text-anchor="end"`));
	}

	const badges = badgeRow(input.queued, input.subagents, META.right, 40);
	parts.push(badges.svg);
	// The worktree mark gives way when the queue and subagent pills need the row.
	if (input.worktree && badges.right >= 78) parts.push(glyph("worktree", 58, 42, 16, COLORS.muted, 2.2));

	const dot = input.unseen === true && input.state !== "done";
	const maxWidth = dot ? 100 : 114;
	const size = fitSize(input.title, maxWidth, TITLE_SIZES);
	parts.push(textBlock(wrapText(input.title, maxWidth, size, 3, { cut: true }), { ...TITLE, size, maxWidth, opacity: dim }));
	if (dot) parts.push(`<circle cx="119" cy="118" r="4.5" fill="${COLORS.unread}"/>`);
	return keySvg(parts.join(""));
}

type ControlTone = "default" | "approve" | "deny";
/** Draws an icon at (x, y) in a `size` box: a provider mark instead of a glyph. */
export type MarkPainter = (x: number, y: number, size: number) => string;
type ControlKeyInput = {
	glyph: GlyphName;
	/** Replaces the glyph, as on the Model key. */
	mark?: MarkPainter;
	label?: string;
	/** Primary actions (Send, Stop) sit in a filled circle. */
	primary?: boolean;
	available?: boolean;
	/** The setting this key applies is the thread's current one. */
	active?: boolean;
	tone?: ControlTone;
	/** The glyph's color when not a tone's: amber for Full access, the accent for Fast. */
	glyphColor?: string;
	/** The label's color; white by default. */
	labelColor?: string;
	/** A faint wash over the key in this color: Full access while it is the thread's. */
	wash?: string;
	/** A label too long for two lines shrinks to four smaller ones instead of fading: a refusal reason. */
	shrink?: boolean;
	/** Ultrathink is armed for the thread this key acts on. */
	ultrathink?: boolean;
	/** A position cue drawn along the bottom (y 110 to 128): the label keeps to one line above it. */
	cue?: string;
	/** The key acts on one thread picked in its settings, not the selection: a small pin top-right. */
	pinned?: boolean;
};

/** The mark of a key aimed at one thread: a small muted pin in the top-right corner. */
const pinMark = () => glyph("pin", 114, 12, 18, COLORS.muted, 2);

const TONE_COLOR: Record<ControlTone, string> = { default: "#FFFFFF", approve: COLORS.done, deny: COLORS.error };
const LABEL = { x: 16.7, maxWidth: 112 } as const;
const LABEL_SIZES = [20, 17] as const;
const SMALL_LABEL = { x: 16.7, lineHeight: 16, size: 14, maxWidth: 112 } as const;

/** Up to two lines, bottom-aligned, a size smaller when a word wouldn't fit; with `shrink`, a longer label takes up to four small lines. */
function labelBlock(label: string, shrink: boolean, cue: boolean, fill?: string): string {
	const size = fitSize(label, LABEL.maxWidth, LABEL_SIZES);
	const lineHeight = size + 2;
	if (cue) {
		const above = wrapText(label, LABEL.maxWidth, size, 2, { cut: true });
		return textBlock(above, { ...LABEL, fill, size, lineHeight, firstBaseline: 98 - (above.lines.length - 1) * lineHeight });
	}
	const wrapped = wrapText(label, LABEL.maxWidth, size, 2, { cut: true });
	if (!wrapped.overflowed || !shrink) return textBlock(wrapped, { ...LABEL, fill, size, lineHeight, firstBaseline: 123 - (wrapped.lines.length - 1) * lineHeight });
	const small = wrapText(label, SMALL_LABEL.maxWidth, SMALL_LABEL.size, 4);
	return textBlock(small, { ...SMALL_LABEL, fill, firstBaseline: 125 - (small.lines.length - 1) * SMALL_LABEL.lineHeight });
}

/** A control: a centered glyph alone, or a top-left glyph over a bottom-left label (and a cue below it). */
export function renderControlKey(input: ControlKeyInput): string {
	const accent = input.glyphColor ?? TONE_COLOR[input.tone ?? "default"];
	const content: string[] = [];
	const label = input.label?.trim();
	if (label) {
		if (input.mark) content.push(input.mark(15, 12, 42));
		else if (input.primary) content.push(`<circle cx="36" cy="33" r="24" fill="${accent}"/>`, glyph(input.glyph, 22, 19, 28, COLORS.key));
		else content.push(glyph(input.glyph, 13, 10, 46, accent));
		content.push(labelBlock(label, input.shrink === true, input.cue !== undefined, input.labelColor));
		if (input.cue) content.push(input.cue);
	} else if (input.mark) {
		content.push(input.mark(36, 36, 72));
	} else if (input.primary) {
		content.push(`<circle cx="72" cy="72" r="47.5" fill="${accent}"/>`, glyph(input.glyph, 50, 50, 44, COLORS.key));
	} else {
		content.push(glyph(input.glyph, 38, 38, 68, accent));
	}
	if (input.pinned) content.push(pinMark());
	const body = input.available === false ? `<g opacity=".5">${content.join("")}</g>` : content.join("");
	const wash = input.wash ? overlay(input.wash, 0.14) : "";
	return keySvg(background(input.active ? COLORS.keyActive : COLORS.key) + wash + body + (input.ultrathink ? ultrathinkFrame(144, 144, 16, 3) : ""));
}

/** Fixed spots (x, y as fractions of the area, star radius in px) so sparkles never jump between repaints. */
const SPARKLE_SPOTS = [
	[0.62, 0.3, 3.4],
	[0.18, 0.68, 2.4],
	[0.86, 0.62, 2.9],
	[0.38, 0.26, 2.1],
	[0.74, 0.22, 2],
	[0.5, 0.72, 3.1],
	[0.28, 0.4, 1.9],
	[0.94, 0.34, 2.2],
	[0.08, 0.3, 2],
	[0.44, 0.52, 1.8],
] as const;

/** A twinkle's brightness through its cycle; each star starts at its own point so they never flash together. */
const TWINKLE = [1, 0.75, 0.4, 0.15, 0.4, 0.75] as const;

/**
 * Still, four-pointed sparkles over a filled track for the upper half of an effort ladder: none below the middle, a
 * few just past it, the most at the top. `t` is the level's place on the ladder, 0 to 1.
 */
export function sparkles(t: number, x: number, y: number, width: number, height: number, step?: number): string {
	if (t < 0.5 || width <= 0) return "";
	const count = Math.min(SPARKLE_SPOTS.length, 2 + Math.round((t - 0.5) * 2 * (SPARKLE_SPOTS.length - 2)));
	return SPARKLE_SPOTS.slice(0, count)
		.map(([fx, fy, r], index) => {
			const cx = +(x + fx * width).toFixed(1);
			const cy = +(y + fy * height).toFixed(1);
			const path = `M${cx} ${cy - r}Q${cx} ${cy} ${cx + r} ${cy}Q${cx} ${cy} ${cx} ${cy + r}Q${cx} ${cy} ${cx - r} ${cy}Q${cx} ${cy} ${cx} ${cy - r}Z`;
			const base = index % 2 === 0 ? 0.95 : 0.7;
			const opacity = step === undefined ? base : base * TWINKLE[(step + index * 2) % TWINKLE.length]!;
			return `<path d="${path}" fill="#FFFFFF" fill-opacity="${opacity.toFixed(2)}"/>`;
		})
		.join("");
}

/** A stepped track, 18 px tall, with the stops inset so the 11 px thumb stays over its ends. */
const TRACK = { height: 18, inset: 12, thumb: 11 } as const;

/** The center of stop `index` of `stops` along a track at `x`, `width` wide. */
export const trackStopX = (x: number, width: number, index: number, stops: number): number =>
	+(x + TRACK.inset + (index * (width - 2 * TRACK.inset)) / Math.max(1, stops - 1)).toFixed(2);

type SteppedTrack = {
	x: number;
	y: number;
	width: number;
	stops: number;
	/** Filled up to with a solid thumb; undefined leaves the track empty. */
	current?: number;
	/** A hollow thumb where a press would move it. */
	preview?: number;
	paint: Paint;
	/** The gradient's id, when `paint` is one. */
	id: string;
	/** Spread a gradient over the stops alone, so a short track still shows most of it at the top stop. */
	gradientOverStops?: boolean;
	/** Sparkles over the fill for an effort this far up its ladder (0 to 1). */
	sparkle?: number;
	/** The sparkles' twinkle step; undefined keeps them still. */
	twinkle?: number;
};

/** Stop dots on a track, the fill up to the current stop under a solid thumb, and an effort's sparkles. */
export function steppedTrack(track: SteppedTrack): string {
	const { x, y, width, stops, current } = track;
	const { height, thumb } = TRACK;
	const stopX = (index: number) => trackStopX(x, width, index, stops);
	const cy = y + height / 2;
	const parts = [`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="#FFFFFF" fill-opacity=".1"/>`];
	if (current !== undefined) {
		const [from, to] = track.gradientOverStops ? [stopX(0), stopX(stops - 1)] : [x, x + width];
		const fill = paintFill(track.paint, track.id, from, to, parts);
		const filled = +(stopX(current) - x + height / 2).toFixed(2);
		parts.push(`<rect x="${x}" y="${y}" width="${filled}" height="${height}" rx="${height / 2}" fill="${fill}"/>`);
		// Sparkles stop short of the thumb, which covers the filled end.
		if (track.sparkle !== undefined) parts.push(sparkles(track.sparkle, x + 2, y, filled - height / 2 - thumb - 4, height, track.twinkle));
	}
	for (let index = 0; index < stops; index++) parts.push(`<circle cx="${stopX(index)}" cy="${cy}" r="2" fill="#FFFFFF" fill-opacity="${current !== undefined && index <= current ? ".5" : ".28"}"/>`);
	if (current !== undefined) parts.push(`<circle cx="${stopX(current)}" cy="${cy}" r="${thumb}" fill="#FFFFFF"/>`);
	const preview = track.preview;
	if (preview !== undefined && preview >= 0 && preview < stops && preview !== current) {
		parts.push(`<circle cx="${stopX(preview)}" cy="${cy}" r="9.5" fill="${COLORS.key}" fill-opacity=".55" stroke="#FFFFFF" stroke-width="2.5"/>`);
	}
	return parts.join("");
}

/** A ladder's track under a key's label (y 110 to 128), filled to `index` in the accent, T3 Code's Ultrathink spectrum or a given paint. */
export function ladderCue(count: number, index: number, spectrum = false, paint?: Paint, sparkle?: number, twinkle?: number): string {
	const stops = Math.max(2, count);
	return steppedTrack({ x: 16, y: 110, width: 112, stops, current: Math.max(0, Math.min(stops - 1, index)), paint: spectrum ? { gradient: SPECTRUM } : (paint ?? COLORS.accent), id: "cue-fill", gradientOverStops: true, sparkle, twinkle });
}

/**
 * One pill per choice, evenly across `box`: the current one in `paint`, a previewed one outlined, the rest dim. Past
 * eight, the pills stand for stretches of the list.
 */
export function pills(box: { x: number; y: number; width: number; height: number; gap: number }, count: number, current: number | undefined, paint: Paint, id: string, preview?: number): string {
	const shown = Math.min(count, 8);
	const width = (box.width - box.gap * (shown - 1)) / shown;
	const slot = (index: number | undefined) => (index === undefined ? undefined : count > shown ? Math.round((index * (shown - 1)) / (count - 1)) : index);
	const at = slot(current);
	const next = slot(preview);
	const parts: string[] = [];
	for (let index = 0; index < shown; index++) {
		const x = +(box.x + index * (width + box.gap)).toFixed(2);
		const pill = (extra: string) => `<rect x="${x}" y="${box.y}" width="${+width.toFixed(2)}" height="${box.height}" rx="${box.height / 2}" ${extra}/>`;
		if (index === at) parts.push(pill(`fill="${paintFill(paint, id, x, x + width, parts)}"`));
		else if (index === next) parts.push(pill(`fill="#FFFFFF" fill-opacity=".18" stroke="#FFFFFF" stroke-width="2"`));
		else parts.push(pill(`fill="#FFFFFF" fill-opacity=".14"`));
	}
	return parts.join("");
}

/** One pill per item along the bottom, sharing the key's width evenly: where a value sits among a few (favorite models). */
export const dotsCue = (count: number, index: number, paint: Paint = "#FFFFFF"): string =>
	pills({ x: 16, y: 118, width: 112, height: 8, gap: count <= 5 ? 8 : 5 }, count, index, paint, "cue-page");

const CAPTION = { x: 72, maxWidth: 124 } as const;

/** A caption centered under a centered glyph: 16px, or 13px over up to three lines when long. */
function caption(text: string, baseline: number): string {
	const big = wrapText(text, CAPTION.maxWidth, 16, 2, { cut: true });
	if (!big.overflowed && big.lines.length === 1) return textBlock(big, { ...CAPTION, size: 16, lineHeight: 18, firstBaseline: baseline, anchor: "middle" });
	const small = wrapText(text, CAPTION.maxWidth, 13, 3);
	return textBlock(small, { ...CAPTION, size: 13, lineHeight: 15, firstBaseline: baseline - (small.lines.length - 1) * 8, anchor: "middle" });
}

/** A press's outcome, shown for a moment: a big tinted check or mark, centered, over what happened or why not. */
export function renderResultKey(input: { ok: boolean; label: string }): string {
	const color = input.ok ? COLORS.done : COLORS.error;
	return keySvg(background(COLORS.key) + glyph(input.ok ? "check" : "error", 44, 20, 56, color) + caption(input.label, 110));
}

/** Approve and Deny, drawn as a pair: a circled check or cross, white while there is something to answer, then what a press does. */
export function renderDecisionKey(input: { kind: "approve" | "deny"; armed: boolean; caption: string; detail?: string; pinned?: boolean }): string {
	const ring = glyph(input.kind === "approve" ? "check" : "denyCircle", 42, input.detail ? 14 : 20, 60, "#FFFFFF", 1.6);
	const parts = [input.armed ? ring : `<g opacity=".45">${ring}</g>`];
	const opacity = input.armed ? undefined : 0.6;
	const size = [16, 14].find((candidate) => textWidth(input.caption, candidate) <= CAPTION.maxWidth) ?? 13;
	parts.push(textBlock(wrapText(input.caption, CAPTION.maxWidth, size, 1, { cut: true }), { ...CAPTION, size, lineHeight: 18, firstBaseline: input.detail ? 104 : 112, anchor: "middle", opacity }));
	if (input.detail) parts.push(textBlock(wrapText(input.detail, CAPTION.maxWidth, 13, 1, { cut: true }), { ...CAPTION, size: 13, lineHeight: 15, firstBaseline: 124, anchor: "middle", opacity: 0.5 }));
	if (input.pinned) parts.push(pinMark());
	return keySvg(background(COLORS.key) + parts.join(""));
}

const SKELETON = `fill="#FFFFFF" fill-opacity=".12"`;

/** A placeholder bar for data on its way. */
export const skeletonRect = (x: number, y: number, width: number, height: number): string =>
	`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" ${SKELETON}/>`;

/** A face whose data is still on its way: a glyph-sized disc and two bars, static. */
export function renderSkeletonKey(): string {
	return keySvg(background(COLORS.key) + `<circle cx="32" cy="32" r="19" ${SKELETON}/>` + skeletonRect(15, 72, 104, 13) + skeletonRect(15, 94, 72, 13));
}

/** The card a first press shows before anything is sent: what, to which thread, and the content, then "press again". */
export function renderReviewKey(input: { glyph: GlyphName; verb: string; target: string; body?: string; footer: string }): string {
	const parts = [background(COLORS.key), overlay(COLORS.accent, 0.12), glyph(input.glyph, 14, 13, 24, COLORS.accent)];
	const verbSize = textWidth(input.verb, 15) <= 86 ? 15 : 13;
	parts.push(textBlock(wrapText(input.verb, 86, verbSize, 1, { cut: true }), { x: 44, firstBaseline: 30, lineHeight: 17, size: verbSize, maxWidth: 86, fill: COLORS.accent }));
	const target = wrapText(input.target, 114, 15, input.body ? 2 : 3, { cut: true });
	parts.push(textBlock(target, { x: TITLE.x, firstBaseline: 60, lineHeight: 18, size: 15, maxWidth: 114 }));
	if (input.body) {
		const first = 60 + target.lines.length * 18 + 2;
		parts.push(textBlock(wrapText(input.body, 114, 13, first > 90 ? 1 : 2), { x: TITLE.x, firstBaseline: first, lineHeight: 15, size: 13, maxWidth: 114, opacity: 0.6 }));
	}
	parts.push(textBlock(wrapText(input.footer, 114, 13, 1, { cut: true }), { x: TITLE.x, firstBaseline: 133, lineHeight: 15, size: 13, maxWidth: 114, fill: COLORS.accent }));
	return keySvg(parts.join(""));
}

type NoticeKeyInput = { glyph: GlyphName; title: string; detail?: string; tone?: "muted" | "attention" };

/** A thread key's title, up to three lines (two over a detail), and a muted detail line under it. */
function titleDetail(text: string, detail: string | undefined): string {
	const size = fitSize(text, 114, TITLE_SIZES);
	const title = wrapText(text, 114, size, detail ? 2 : 3, { cut: true });
	const block = textBlock(title, { ...TITLE, size, maxWidth: 114 });
	if (!detail) return block;
	const firstBaseline = TITLE.firstBaseline + title.lines.length * TITLE.lineHeight;
	return block + textBlock(wrapText(detail, 114, 15, 1), { x: TITLE.x, firstBaseline, lineHeight: 18, size: 15, maxWidth: 114, opacity: 0.5 });
}

/** Sign-in, connection and removal notices, laid out like a thread key so they read as native. */
export function renderNoticeKey(input: NoticeKeyInput): string {
	const attention = input.tone === "attention";
	const parts = [background(COLORS.key)];
	if (attention) parts.push(overlay(COLORS.attention, 0.18), glyph(input.glyph, 12, 12, 40, COLORS.attention));
	else parts.push(`<g opacity=".5">${glyph(input.glyph, 12, 12, 40)}</g>`);
	parts.push(titleDetail(input.title, input.detail));
	return keySvg(parts.join(""));
}

type InfoKeyInput = {
	glyph: GlyphName;
	mark?: MarkPainter;
	/** Glyph color; white by default. */
	color?: string;
	/** A faint wash over the key, as thread keys use for attention and failure. */
	tint?: string;
	title: string;
	detail?: string;
	available?: boolean;
	active?: boolean;
	/** The key acts on one thread picked in its settings: a small pin top-right. */
	pinned?: boolean;
	/** The glyph's rotation in degrees, for a spinner. */
	spin?: number;
};

/** A status: icon top-left, a title of up to three lines, and an optional muted detail line, laid out like a thread key. */
export function renderInfoKey(input: InfoKeyInput): string {
	const parts = [background(input.active ? COLORS.keyActive : COLORS.key)];
	if (input.tint) parts.push(overlay(input.tint, 0.2));
	const content = [input.mark ? input.mark(14, 14, 36) : glyph(input.glyph, 12, 12, 40, input.color ?? COLORS.text, 2, input.spin ?? 0), titleDetail(input.title, input.detail)];
	if (input.pinned) content.push(pinMark());
	parts.push(input.available === false ? `<g opacity=".5">${content.join("")}</g>` : content.join(""));
	return keySvg(parts.join(""));
}

/** How a dial strip's background looks: T3 Code's card, Flow (one picture across adjacent dials), tinted by thread state, or one color. */
type StripBackground = "t3" | "flow" | "state" | "custom";
/** `run` places a dial in its run of adjacent dials, for Flow; `pet` is the idle pet's art while it crosses this strip. */
export type StripAppearance = { background: StripBackground; color?: string; run?: Run; pet?: string };
/** What a strip is about, for the State background: done, failed, waiting on you, or nothing to report. */
export type StripTone = "done" | "failed" | "attention" | "neutral";

export const DEFAULT_APPEARANCE: StripAppearance = { background: "t3" };

/** A stored background, or undefined for one this version doesn't know. */
export const stripBackground = (value: unknown): StripBackground | undefined =>
	value === "t3" || value === "flow" || value === "state" || value === "custom" ? value : undefined;

export const isHexColor = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);

/** The dial's own background when it sets one, else the global one; a custom color must be `#rrggbb`. */
export function resolveAppearance(
	global: { stripBackground?: unknown; stripColor?: unknown },
	dial: { background?: unknown; backgroundColor?: unknown } = {},
): StripAppearance {
	const own = stripBackground(dial.background);
	const background = own ?? stripBackground(global.stripBackground) ?? "t3";
	const color = own === "custom" ? dial.backgroundColor : global.stripColor;
	if (background !== "custom") return { background };
	return isHexColor(color) ? { background, color } : { background: "t3" };
}

/** A state's strip tone, matching thread keys: a done thread stays green only while unseen (`unseen` false). */
export const toneOf = (state: DeckState | undefined, unseen?: boolean): StripTone =>
	state === "done" ? (unseen === false ? "neutral" : "done") : state === "failed" ? "failed" : state === "approval" || state === "question" ? "attention" : "neutral";

const TONE_TINT: Record<Exclude<StripTone, "neutral">, string> = { done: COLORS.done, failed: COLORS.error, attention: COLORS.attention };

const FLOW = { width: 200, height: 100 } as const;

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
	const width = FLOW.width * Math.max(1, run.length);
	const ribbon = (id: string, from: string, to: string) =>
		`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="0">${gradientStops([[0, from], [0.5, to], [1, from]])}</linearGradient>`;
	const glow = (id: string, color: string, cx: number, cy: number, r: number, opacity: number) =>
		`<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="${color}" stop-opacity="${opacity}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`;
	const defs =
		`<defs><linearGradient id="flow-field" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${width}" y2="${FLOW.height}">${gradientStops([[0, "#0C1222"], [0.55, "#14122A"], [1, "#0E1A24"]])}</linearGradient>` +
		ribbon("flow-a", COLORS.accent, "#8B6CF6") +
		ribbon("flow-b", "#2BB3A3", COLORS.accent) +
		glow("flow-low", COLORS.accent, width * 0.22, FLOW.height * 1.25, Math.max(170, width * 0.4), 0.26) +
		glow("flow-high", "#8B6CF6", width * 0.82, -FLOW.height * 0.2, Math.max(150, width * 0.32), 0.16) +
		`</defs>`;
	const body =
		`<rect width="${width}" height="${FLOW.height}" fill="url(#flow-field)"/><rect width="${width}" height="${FLOW.height}" fill="url(#flow-low)"/><rect width="${width}" height="${FLOW.height}" fill="url(#flow-high)"/>` +
		`<path d="${wave(width, 74, 15, 520, 60)}" fill="none" stroke="url(#flow-a)" stroke-width="34" stroke-opacity=".16" stroke-linecap="round"/>` +
		`<path d="${wave(width, 87, 8, 300, 150)}" fill="none" stroke="url(#flow-b)" stroke-width="9" stroke-opacity=".28" stroke-linecap="round"/>` +
		`<path d="${wave(width, 70, 12, 520, 60)}" fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-opacity=".14"/>`;
	return `${defs}<g transform="translate(${-run.position * FLOW.width} 0)">${body}</g>`;
}

function stripFill(appearance: StripAppearance, tone: StripTone): string {
	switch (appearance.background) {
		case "flow":
			return flowArt(appearance.run ?? { length: 1, position: 0 });
		case "custom":
			return `<rect width="200" height="100" fill="${appearance.color}"/>`;
		case "state":
			if (tone === "neutral") break;
			return (
				`<defs><linearGradient id="t" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${TONE_TINT[tone]}" stop-opacity=".32"/><stop offset="1" stop-color="${TONE_TINT[tone]}" stop-opacity=".1"/></linearGradient></defs>` +
				`<rect width="200" height="100" fill="${COLORS.card}"/><rect width="200" height="100" fill="url(#t)"/>`
			);
	}
	return `<rect width="200" height="100" fill="${COLORS.card}"/>`;
}

/** Touch-strip background, with T3 Code's Ultrathink frame when armed. */
export function stripCanvas(appearance: StripAppearance = DEFAULT_APPEARANCE, tone: StripTone = "neutral", ultrathink = false): string {
	return svgImage(200, 100, `${stripFill(appearance, tone)}${appearance.pet ?? ""}${ultrathink ? ultrathinkFrame(200, 100, 8, 2) : ""}`);
}

/** A glyph as a painter, so strips can draw it at any size or compose it into a larger picture. */
export const glyphArt =
	(name: GlyphName, color: string = COLORS.text): MarkPainter =>
	(x, y, size) =>
		glyph(name, x, y, size, color);

/** A glyph in any paint: a gradient shows through the glyph's shape, laid corner to corner. */
export function paintedGlyphArt(name: GlyphName, paint: Paint): MarkPainter {
	if (typeof paint === "string") return glyphArt(name, paint);
	// Named by what it draws, so the same picture is the same markup and repaints dedupe.
	const colors = paint.gradient.map(([offset, color]) => `${color.slice(1)}${offset}`).join("-");
	return (x, y, size) => {
		const id = `glyph-${name}-${x}-${y}-${size}-${colors}`;
		return (
			`<defs><linearGradient id="${id}-fill" gradientUnits="userSpaceOnUse" x1="${x}" y1="${y}" x2="${x + size}" y2="${y + size}">${gradientStops(paint.gradient)}</linearGradient>` +
			`<mask id="${id}" maskUnits="userSpaceOnUse" x="${x}" y="${y}" width="${size}" height="${size}">${glyph(name, x, y, size, "#FFFFFF")}</mask></defs>` +
			`<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="url(#${id}-fill)" mask="url(#${id})"/>`
		);
	};
}

/** A provider mark (or any painter) in a square icon slot, 38×38 by default: the strip's. */
export const stripMarkIcon = (mark: MarkPainter, box = 38): string => svgImage(box, box, mark(1, 1, box - 2));

export const stripIcon = (name: GlyphName, color: string = COLORS.text): string => stripMarkIcon(glyphArt(name, color));

/** A strip text line drawn as a picture, for text wider than its slot. */
type LineArt = { text: string; width: number; height: number; size: number; weight: number; color: string; offset: number; overflow: number };

const FADE_PX = 14;

/** `text` shifted left by `offset`, fading out at whichever edge still hides text. */
export function lineArt(line: LineArt): string {
	const baseline = Math.round(line.height / 2 + line.size * 0.36);
	const left = line.offset > 0 ? FADE_PX / line.width : 0;
	const right = line.offset < line.overflow ? 1 - FADE_PX / line.width : 1;
	const mask =
		`<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="${left > 0 ? 0 : 1}"/><stop offset="${left}" stop-color="#fff"/><stop offset="${right}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="${right < 1 ? 0 : 1}"/></linearGradient>` +
		`<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${line.width}" height="${line.height}"><rect width="${line.width}" height="${line.height}" fill="url(#f)"/></mask></defs>`;
	const text = svgText(line.text, -line.offset, baseline, line.size, line.weight, line.color, ` xml:space="preserve"`);
	return svgImage(line.width, line.height, `${mask}<g mask="url(#m)">${text}</g>`);
}

/** Wrapped `lines` rolled up by `offset` px, one slot height per line, the last followed by the first again. */
type RollArt = { lines: readonly string[]; width: number; height: number; size: number; weight: number; color: string; offset: number };

export function rollArt(art: RollArt): string {
	const baseline = Math.round(art.height / 2 + art.size * 0.36);
	const step = Math.floor(art.offset / art.height);
	const shift = art.offset - step * art.height;
	const line = (index: number, y: number) => svgText(art.lines[index % art.lines.length] ?? "", 0, y, art.size, art.weight, art.color, ` xml:space="preserve"`);
	const body = line(step, baseline - shift) + (shift > 0 ? line(step + 1, baseline - shift + art.height) : "");
	return svgImage(art.width, art.height, body);
}

/** Text in the system font, for pictures drawn outside the layouts' native text items. */
export const svgText = (content: string, x: number, y: number, size: number, weight: number, fill: string, extra = "") =>
	`<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${escapeXml(content)}</text>`;

/** Clears a strip picture slot. */
export const BLANK_ART = svgImage(1, 1, "");
