import type { DeckState } from "./board.js";
import { flowArt, type Run } from "./flow.js";
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
	attention: "#FF8549",
	accent: "#5B8CFF",
	unread: "#007BE5",
	dim: "#3A3D44",
} as const;

export const STATE_COLOR: Record<DeckState, string> = {
	approval: COLORS.attention,
	question: COLORS.attention,
	running: COLORS.accent,
	queued: COLORS.muted,
	done: COLORS.done,
	failed: COLORS.error,
	stopped: COLORS.muted,
	idle: COLORS.muted,
};

/** T3 Code's Lucide icons on a 24-unit grid; Stop is filled like T3's composer stop button. */
const GLYPHS = {
	...LUCIDE,
	stop: `<rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" stroke="none"/>`,
	/** Lucide's play, filled: Stop's Resume face. */
	play: `<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor" stroke="none"/>`,
	/** Lucide's circle-x, Deny's counterpart to the circled check. */
	denyCircle: `<circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />`,
	/** Lucide's check and message-circle: a thread key's done and idle marks. */
	checkBare: `<path d="M20 6 9 17l-5-5" />`,
	chatRound: `<path d="M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719" />`,
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
const ULTRATHINK_STOPS = ["#D76868", "#D49324", "#33AE61", "#28A396", "#4176CE", "#C54986", "#D76868"];
const SPECTRUM_OFFSETS = [0, 0.18, 0.36, 0.54, 0.72, 0.9, 1];

/** The spectrum's gradient stops, for fills that carry it (Ultrathink on a track). */
export const spectrumStops = (): string => ULTRATHINK_STOPS.map((color, index) => `<stop offset="${SPECTRUM_OFFSETS[index]}" stop-color="${color}"/>`).join("");

/** How a model's top effort level stands out (Advanced → Max effort color): a blue-to-violet gradient by default. */
export type MaxEffortStyle = "gradient" | "solid" | "model" | "off";
export const maxEffortStyle = (value: unknown): MaxEffortStyle => (value === "solid" || value === "model" || value === "off" ? value : "gradient");

const MAX_VIOLET = "#AD7BF9";
const MAX_STOPS = `<stop offset="0" stop-color="#648FFD"/><stop offset=".55" stop-color="${MAX_VIOLET}"/><stop offset="1" stop-color="#8B84FB"/>`;

/** A fill: one color, or gradient stops laid along the shape's run. */
export type Paint = string | { stops: string };

/** What the top effort level paints: `text` for its word and icon, `fill` for a track; undefined leaves them as usual. */
export function maxEffortPaint(style: MaxEffortStyle, modelColor: string | undefined): { text: string; fill: Paint } | undefined {
	switch (style) {
		case "gradient":
			return { text: MAX_VIOLET, fill: { stops: MAX_STOPS } };
		case "solid":
			return { text: MAX_VIOLET, fill: MAX_VIOLET };
		case "model":
			return modelColor === undefined ? undefined : { text: modelColor, fill: modelColor };
		case "off":
			return undefined;
	}
}

/** `paint` as a fill attribute value, defining its gradient (`id`, along x1→x2) into `defs` when it has one. */
export function paintFill(paint: Paint, id: string, x1: number, x2: number, defs: string[]): string {
	if (typeof paint === "string") return paint;
	defs.push(`<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="0" x2="${x2}" y2="0">${paint.stops}</linearGradient></defs>`);
	return `url(#${id})`;
}

/** A static 120° spectrum border, like T3 Code's composer while Ultrathink is on. */
export function ultrathinkFrame(width: number, height: number, radius: number, stroke: number): string {
	const stops = ULTRATHINK_STOPS.map((color, index) => `<stop offset="${SPECTRUM_OFFSETS[index]}" stop-color="${color}"/>`).join("");
	const inset = stroke / 2;
	return (
		`<defs><linearGradient id="ultrathink" gradientUnits="userSpaceOnUse" x1="0" y1="${height * 0.21}" x2="${width}" y2="${height * 0.79}">${stops}</linearGradient></defs>` +
		`<rect x="${inset}" y="${inset}" width="${width - stroke}" height="${height - stroke}" rx="${radius}" fill="none" stroke="url(#ultrathink)" stroke-width="${stroke}"/>`
	);
}

export const FONT_FAMILY =
	process.platform === "win32" ? `'Segoe UI Variable','Segoe UI',sans-serif` : `-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif`;

export const escapeXml = (text: string) =>
	text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const keySvg = (body: string) =>
	svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${body}</svg>`);

export function glyph(name: GlyphName, x: number, y: number, size: number, color: string = COLORS.text, strokeWidth = 2, rotate = 0): string {
	const scale = size / 24;
	return `<g transform="translate(${x} ${y}) scale(${scale})${rotate ? ` rotate(${rotate} 12 12)` : ""}" fill="none" stroke="${color}" color="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`;
}

const NARROW = new Set("ilI1|.,:;'!`");
const WIDE = new Set("MW@#%&");

/** Approximate advance of `text` in px for the system UI font at weight 600. */
export function textWidth(text: string, fontSize: number): number {
	let em = 0;
	for (const char of text) {
		if (char === " ") em += 0.33;
		else if (NARROW.has(char)) em += 0.3;
		else if (WIDE.has(char)) em += 0.85;
		else if (char >= "0" && char <= "9") em += 0.58;
		else if (char >= "A" && char <= "Z") em += 0.64;
		else em += 0.56;
	}
	return em * fontSize;
}

/** Longest character prefix of `text` that fits `maxWidth`, at least one character. */
function fitChars(text: string, maxWidth: number, fontSize: number): string {
	const chars = [...text];
	let end = 1;
	while (end < chars.length && textWidth(chars.slice(0, end + 1).join(""), fontSize) <= maxWidth) end++;
	return chars.slice(0, end).join("");
}

/** Wrapped lines; `overflowed` when text was left over, `cut` lists lines that end mid-word, both drawn faded. */
export type Wrapped = { lines: string[]; overflowed: boolean; cut?: number[] };

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
export function fitSize(text: string, maxWidth: number, sizes: readonly number[]): number {
	const words = text.trim().split(/\s+/);
	return sizes.find((size) => words.every((word) => textWidth(word, size) <= maxWidth)) ?? sizes[sizes.length - 1];
}

type TextStyle = { x: number; size: number; fill?: string; opacity?: number; anchor?: "end" | "middle" };

const textEl = (content: string, y: number, style: TextStyle, extra = "") =>
	`<text x="${style.x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${style.size}" font-weight="600" fill="${style.fill ?? "#FFFFFF"}"${
		style.opacity === undefined ? "" : ` fill-opacity="${style.opacity}"`
	}${style.anchor ? ` text-anchor="${style.anchor}"` : ""}${extra}>${escapeXml(content)}</text>`;

type BlockOptions = { x: number; firstBaseline: number; lineHeight: number; size: number; maxWidth: number; opacity?: number; fill?: string; anchor?: "middle" };

/** Lines from `firstBaseline` down; a cut line, and an overflowed last line, fade out over the right edge of the wrap box. */
function textBlock({ lines, overflowed, cut }: Wrapped, opts: BlockOptions): string {
	const style: TextStyle = { x: opts.x, size: opts.size, opacity: opts.opacity, fill: opts.fill, anchor: opts.anchor };
	return lines
		.map((line, index) => {
			const y = opts.firstBaseline + index * opts.lineHeight;
			const fades = cut?.includes(index) || (overflowed && index === lines.length - 1);
			if (!fades) return textEl(line, y, style);
			const end = opts.anchor === "middle" ? opts.x + opts.maxWidth / 2 : opts.x + opts.maxWidth;
			const top = y - opts.size;
			const height = opts.size * 1.6;
			return (
				`<defs><linearGradient id="fade-g${y}" gradientUnits="userSpaceOnUse" x1="${end - 28}" y1="0" x2="${end}" y2="0"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>` +
				`<mask id="fade${y}" maskUnits="userSpaceOnUse" x="0" y="${top}" width="144" height="${height}"><rect x="0" y="${top}" width="144" height="${height}" fill="url(#fade-g${y})"/></mask></defs>` +
				textEl(line, y, style, ` mask="url(#fade${y})"`)
			);
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

export type ThreadKeyInput = {
	state: DeckState;
	title: string;
	/** Top-right text, usually elapsed time. A non-empty `diff` takes its place. */
	meta?: string;
	diff?: { additions: number; deletions: number };
	unseen?: boolean;
	/** True on the selected thread's key, false on the others; undefined when nothing is selected. */
	selected?: boolean;
	motion?: KeyMotion;
};

/** The wash and glyph color of a state that wants attention: amber waiting on you, red failed, green unseen done. */
export function threadTint(state: DeckState, unseen = false): string | undefined {
	if (state === "approval" || state === "question") return COLORS.attention;
	if (state === "failed") return COLORS.error;
	if (state === "done" && unseen) return COLORS.done;
	return undefined;
}

/** A thread key's tile: gray, or a deep shade of what it needs (amber waiting on you, red failed, green unseen done). */
const THREAD_TILE = { base: "#363636", [COLORS.attention]: "#5B3322", [COLORS.error]: "#5C2328", [COLORS.done]: "#1E4A32" } as Record<string, string>;

/** Wash opacities over the tile: a selected key's white, and how far a pulse or flash brightens it. */
export const WASH = { selected: 0.15, selectedTint: 0.1 } as const;
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
			textEl(`+${diff.additions}`, META.baseline, { x: additionsRight, size: META.size, fill: COLORS.done, anchor: "end" }),
			textEl(deletions, META.baseline, { x: META.right, size: META.size, fill: COLORS.error, anchor: "end" }),
		);
	} else if (input.meta) {
		parts.push(textEl(input.meta, META.baseline, { x: META.right, size: META.size, fill: "#9A9A9A", anchor: "end" }));
	}

	const dot = input.unseen === true && input.state !== "done";
	const maxWidth = dot ? 100 : 114;
	const size = fitSize(input.title, maxWidth, TITLE_SIZES);
	parts.push(textBlock(wrapText(input.title, maxWidth, size, 3, { cut: true }), { ...TITLE, size, maxWidth, opacity: dim }));
	if (dot) parts.push(`<circle cx="119" cy="118" r="4.5" fill="${COLORS.unread}"/>`);
	return keySvg(parts.join(""));
}

export type ControlTone = "default" | "approve" | "deny";
/** Draws an icon at (x, y) in a `size` box: a provider mark instead of a glyph. */
export type MarkPainter = (x: number, y: number, size: number) => string;
export type ControlKeyInput = {
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
};

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
	const body = input.available === false ? `<g opacity=".5">${content.join("")}</g>` : content.join("");
	const wash = input.wash ? overlay(input.wash, 0.14) : "";
	return keySvg(background(input.active ? COLORS.keyActive : COLORS.key) + wash + body + (input.ultrathink ? ultrathinkFrame(144, 144, 16, 3) : ""));
}

/** Stops along a track (y 110 to 128): `index` filled up to, in the accent, T3 Code's Ultrathink spectrum or a given paint. */
export function ladderCue(count: number, index: number, spectrum = false, paint?: Paint): string {
	const stops = Math.max(2, count);
	const at = Math.max(0, Math.min(stops - 1, index));
	const step = 92 / (stops - 1);
	const x = (i: number) => +(26 + i * step).toFixed(2);
	const defs: string[] = [];
	const fill = paintFill(spectrum ? { stops: spectrumStops() } : (paint ?? COLORS.accent), "cue-fill", 16, 128, defs);
	const dots = Array.from({ length: stops }, (_, i) => `<circle cx="${x(i)}" cy="119" r="2" fill="#FFFFFF" fill-opacity="${i <= at ? ".55" : ".25"}"/>`).join("");
	return `${defs.join("")}<rect x="16" y="110" width="112" height="18" rx="9" fill="#FFFFFF" fill-opacity=".1"/><rect x="16" y="110" width="${+(x(at) - 16 + 9).toFixed(2)}" height="18" rx="9" fill="${fill}"/>${dots}<circle cx="${x(at)}" cy="119" r="10" fill="#FFFFFF"/>`;
}

/** One pill per item, the current one bright: where a value sits among a few (favorite models). */
export function dotsCue(count: number, index: number): string {
	const shown = Math.min(count, 8);
	const width = shown <= 5 ? 16 : 10;
	const gap = shown <= 5 ? 8 : 4;
	const at = count > shown ? Math.round((index * (shown - 1)) / (count - 1)) : index;
	return Array.from({ length: shown }, (_, i) => `<rect x="${16 + i * (width + gap)}" y="118" width="${width}" height="8" rx="4" fill="#FFFFFF"${i === at ? "" : ` fill-opacity=".14"`}/>`).join("");
}

/** A small mode pill: filled when the key's mode is the thread's, outlined when it only applies it. */
export const pillCue = (filled: boolean, color: string = COLORS.accent): string =>
	filled ? `<rect x="16" y="119" width="24" height="7" rx="3.5" fill="${color}"/>` : `<rect x="16.75" y="119.75" width="22.5" height="5.5" rx="2.75" fill="none" stroke="${color}" stroke-width="1.5"/>`;

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
export function renderDecisionKey(input: { kind: "approve" | "deny"; armed: boolean; caption: string; detail?: string }): string {
	const ring = glyph(input.kind === "approve" ? "check" : "denyCircle", 42, input.detail ? 14 : 20, 60, "#FFFFFF", 1.6);
	const parts = [input.armed ? ring : `<g opacity=".45">${ring}</g>`];
	const opacity = input.armed ? undefined : 0.6;
	const size = [16, 14].find((candidate) => textWidth(input.caption, candidate) <= CAPTION.maxWidth) ?? 13;
	parts.push(textBlock(wrapText(input.caption, CAPTION.maxWidth, size, 1, { cut: true }), { ...CAPTION, size, lineHeight: 18, firstBaseline: input.detail ? 104 : 112, anchor: "middle", opacity }));
	if (input.detail) parts.push(textBlock(wrapText(input.detail, CAPTION.maxWidth, 13, 1, { cut: true }), { ...CAPTION, size: 13, lineHeight: 15, firstBaseline: 124, anchor: "middle", opacity: 0.5 }));
	return keySvg(background(COLORS.key) + parts.join(""));
}

/** A face whose data is still on its way: a glyph-sized disc and two bars, static. */
export function renderSkeletonKey(): string {
	const bar = (y: number, width: number) => `<rect x="15" y="${y}" width="${width}" height="13" rx="6.5" fill="#FFFFFF" fill-opacity=".1"/>`;
	return keySvg(background(COLORS.key) + `<circle cx="32" cy="32" r="19" fill="#FFFFFF" fill-opacity=".1"/>` + bar(72, 104) + bar(94, 72));
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

export type NoticeKeyInput = { glyph: GlyphName; title: string; detail?: string; tone?: "muted" | "attention" };

/** Sign-in, connection and removal notices, laid out like a thread key so they read as native. */
export function renderNoticeKey(input: NoticeKeyInput): string {
	const attention = input.tone === "attention";
	const parts = [background(COLORS.key)];
	if (attention) parts.push(overlay(COLORS.attention, 0.18), glyph(input.glyph, 12, 12, 40, COLORS.attention));
	else parts.push(`<g opacity=".5">${glyph(input.glyph, 12, 12, 40)}</g>`);
	const size = fitSize(input.title, 114, TITLE_SIZES);
	const title = wrapText(input.title, 114, size, input.detail ? 2 : 3, { cut: true });
	parts.push(textBlock(title, { ...TITLE, size, maxWidth: 114 }));
	if (input.detail) {
		const firstBaseline = TITLE.firstBaseline + title.lines.length * TITLE.lineHeight;
		parts.push(textBlock(wrapText(input.detail, 114, 15, 1), { x: TITLE.x, firstBaseline, lineHeight: 18, size: 15, maxWidth: 114, opacity: 0.5 }));
	}
	return keySvg(parts.join(""));
}

export type InfoKeyInput = {
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
};

/** A status: icon top-left, a title of up to three lines, and an optional muted detail line, laid out like a thread key. */
export function renderInfoKey(input: InfoKeyInput): string {
	const parts = [background(input.active ? COLORS.keyActive : COLORS.key)];
	if (input.tint) parts.push(overlay(input.tint, 0.2));
	const content: string[] = [input.mark ? input.mark(14, 14, 36) : glyph(input.glyph, 12, 12, 40, input.color ?? COLORS.text)];
	const size = fitSize(input.title, 114, TITLE_SIZES);
	const title = wrapText(input.title, 114, size, input.detail ? 2 : 3, { cut: true });
	content.push(textBlock(title, { ...TITLE, size, maxWidth: 114 }));
	if (input.detail) {
		const firstBaseline = TITLE.firstBaseline + title.lines.length * TITLE.lineHeight;
		content.push(textBlock(wrapText(input.detail, 114, 15, 1), { x: TITLE.x, firstBaseline, lineHeight: 18, size: 15, maxWidth: 114, opacity: 0.5 }));
	}
	parts.push(input.available === false ? `<g opacity=".5">${content.join("")}</g>` : content.join(""));
	return keySvg(parts.join(""));
}

/** How a dial strip's background looks: T3 Code's card, Flow (one picture across adjacent dials), tinted by thread state, or one color. */
export type StripBackground = "t3" | "flow" | "state" | "custom";
/** `run` places a dial in its run of adjacent dials, for Flow. */
export type StripAppearance = { background: StripBackground; color?: string; hairline: boolean; run?: Run };
/** What a strip is about, for the State background: done, failed, waiting on you, or nothing to report. */
export type StripTone = "done" | "failed" | "attention" | "neutral";

export const DEFAULT_APPEARANCE: StripAppearance = { background: "t3", hairline: true };

/** A stored background; the retired Gradient reads as T3 Code's. */
export const stripBackground = (value: unknown): StripBackground | undefined =>
	value === "gradient" ? "t3" : value === "t3" || value === "flow" || value === "state" || value === "custom" ? value : undefined;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** The dial's own background when it sets one, else the global one; a custom color must be `#rrggbb`. */
export function resolveAppearance(
	global: { stripBackground?: unknown; stripColor?: unknown; stripHairline?: unknown },
	dial: { background?: unknown; backgroundColor?: unknown } = {},
): StripAppearance {
	const own = stripBackground(dial.background);
	const background = own ?? stripBackground(global.stripBackground) ?? "t3";
	const color = own === "custom" ? dial.backgroundColor : global.stripColor;
	const hairline = global.stripHairline !== false && global.stripHairline !== "false";
	if (background !== "custom") return { background, hairline };
	return typeof color === "string" && HEX_COLOR.test(color) ? { background, color, hairline } : { background: "t3", hairline };
}

/** A state's strip tone, matching thread keys: a done thread stays green only while unseen (`unseen` false). */
export const toneOf = (state: DeckState | undefined, unseen?: boolean): StripTone =>
	state === "done" ? (unseen === false ? "neutral" : "done") : state === "failed" ? "failed" : state === "approval" || state === "question" ? "attention" : "neutral";

const TONE_TINT: Record<Exclude<StripTone, "neutral">, string> = { done: COLORS.done, failed: COLORS.error, attention: COLORS.attention };
const T3_CARD = "#121212";

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
				`<rect width="200" height="100" fill="${T3_CARD}"/><rect width="200" height="100" fill="url(#t)"/>`
			);
	}
	return `<rect width="200" height="100" fill="${T3_CARD}"/>`;
}

/** Touch-strip background, with a hairline tinted by state unless turned off, and T3 Code's Ultrathink frame when armed. */
export function stripCanvas(accent: string = COLORS.accent, appearance: StripAppearance = DEFAULT_APPEARANCE, tone: StripTone = "neutral", ultrathink = false): string {
	const hairline = appearance.hairline ? `<rect y="97" width="200" height="3" fill="${accent}" fill-opacity=".85"/>` : "";
	return svgDataUrl(
		`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100">${stripFill(appearance, tone)}${hairline}${ultrathink ? ultrathinkFrame(200, 100, 8, 2) : ""}</svg>`,
	);
}

/** A glyph as a painter, so strips can draw it at any size or compose it into a larger picture. */
export const glyphArt =
	(name: GlyphName, color: string = COLORS.text): MarkPainter =>
	(x, y, size) =>
		glyph(name, x, y, size, color);

/** A provider mark (or any painter) in a square icon slot, 38×38 by default: the strip's. */
export const stripMarkIcon = (mark: MarkPainter, box = 38): string =>
	svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${box}" height="${box}" viewBox="0 0 ${box} ${box}">${mark(1, 1, box - 2)}</svg>`);

export const stripIcon = (name: GlyphName, color: string = COLORS.text): string => stripMarkIcon(glyphArt(name, color));

/** A strip text line drawn as a picture, for text wider than its slot. */
export type LineArt = { text: string; width: number; height: number; size: number; weight: number; color: string; offset: number; overflow: number };

const FADE_PX = 14;

/** `text` shifted left by `offset`, fading out at whichever edge still hides text. */
export function lineArt(line: LineArt): string {
	const baseline = Math.round(line.height / 2 + line.size * 0.36);
	const left = line.offset > 0 ? FADE_PX / line.width : 0;
	const right = line.offset < line.overflow ? 1 - FADE_PX / line.width : 1;
	const mask =
		`<defs><linearGradient id="f" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="${left > 0 ? 0 : 1}"/><stop offset="${left}" stop-color="#fff"/><stop offset="${right}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="${right < 1 ? 0 : 1}"/></linearGradient>` +
		`<mask id="m" maskUnits="userSpaceOnUse" x="0" y="0" width="${line.width}" height="${line.height}"><rect width="${line.width}" height="${line.height}" fill="url(#f)"/></mask></defs>`;
	const text = `<text x="${-line.offset}" y="${baseline}" font-family="${FONT_FAMILY}" font-size="${line.size}" font-weight="${line.weight}" fill="${line.color}" xml:space="preserve">${escapeXml(line.text)}</text>`;
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${line.width}" height="${line.height}" viewBox="0 0 ${line.width} ${line.height}">${mask}<g mask="url(#m)">${text}</g></svg>`);
}

/** Wrapped `lines` rolled up by `offset` px, one slot height per line, the last followed by the first again. */
export type RollArt = { lines: readonly string[]; width: number; height: number; size: number; weight: number; color: string; offset: number };

export function rollArt(art: RollArt): string {
	const baseline = Math.round(art.height / 2 + art.size * 0.36);
	const step = Math.floor(art.offset / art.height);
	const shift = art.offset - step * art.height;
	const line = (index: number, y: number) =>
		`<text x="0" y="${y}" font-family="${FONT_FAMILY}" font-size="${art.size}" font-weight="${art.weight}" fill="${art.color}" xml:space="preserve">${escapeXml(art.lines[index % art.lines.length] ?? "")}</text>`;
	const body = line(step, baseline - shift) + (shift > 0 ? line(step + 1, baseline - shift + art.height) : "");
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${art.width}" height="${art.height}" viewBox="0 0 ${art.width} ${art.height}">${body}</svg>`);
}

/** Text in the system font, for pictures drawn outside the layouts' native text items. */
export const svgText = (content: string, x: number, y: number, size: number, weight: number, fill: string, extra = "") =>
	`<text x="${x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${size}" font-weight="${weight}" fill="${fill}"${extra}>${escapeXml(content)}</text>`;

/** Clears a strip picture slot. */
export const BLANK_ART = svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>`);
