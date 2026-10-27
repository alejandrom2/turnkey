import type { DeckState } from "./board.js";
import { LUCIDE } from "./icons.js";

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
const THREAD_GLYPH: Record<DeckState, GlyphName> = {
	approval: "clock",
	question: "clock",
	running: "spinner",
	queued: "clock",
	done: "check",
	failed: "error",
	stopped: "pause",
	idle: "chat",
};

const FONT_FAMILY =
	process.platform === "win32" ? `'Segoe UI Variable','Segoe UI',sans-serif` : `-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif`;

const escapeXml = (text: string) =>
	text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

const keySvg = (body: string) =>
	svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${body}</svg>`);

export function glyph(name: GlyphName, x: number, y: number, size: number, color: string = COLORS.text, strokeWidth = 2): string {
	const scale = size / 24;
	return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" color="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`;
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

/**
 * Greedy word wrap by measured width. Words wider than a line are broken by character. When text is
 * left over, the last line is filled to the edge and `overflowed` is set so the caller can fade it.
 */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines: number): { lines: string[]; overflowed: boolean } {
	let rest = text.trim().replace(/\s+/g, " ");
	const lines: string[] = [];
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
		}
		if (!line) line = fitChars(rest, maxWidth, fontSize).trimEnd();
		lines.push(line);
		rest = rest.slice(line.length).trimStart();
	}
	return { lines, overflowed: rest.length > 0 };
}

type TextStyle = { x: number; size: number; fill?: string; opacity?: number; anchor?: "end" };

const textEl = (content: string, y: number, style: TextStyle, extra = "") =>
	`<text x="${style.x}" y="${y}" font-family="${FONT_FAMILY}" font-size="${style.size}" font-weight="600" fill="${style.fill ?? "#FFFFFF"}"${
		style.opacity === undefined ? "" : ` fill-opacity="${style.opacity}"`
	}${style.anchor ? ` text-anchor="${style.anchor}"` : ""}${extra}>${escapeXml(content)}</text>`;

type BlockOptions = { x: number; firstBaseline: number; lineHeight: number; size: number; maxWidth: number; opacity?: number };

/** Left-aligned lines; an overflowed last line fades out over the right edge of the wrap box. */
function textBlock({ lines, overflowed }: { lines: string[]; overflowed: boolean }, opts: BlockOptions): string {
	const style: TextStyle = { x: opts.x, size: opts.size, opacity: opts.opacity };
	return lines
		.map((line, index) => {
			const y = opts.firstBaseline + index * opts.lineHeight;
			if (!overflowed || index < lines.length - 1) return textEl(line, y, style);
			const end = opts.x + opts.maxWidth;
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

export const elapsed = (since: number | undefined, now: number): string => {
	if (since === undefined) return "";
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const background = (fill: string) => `<rect width="144" height="144" fill="${fill}"/>`;
const overlay = (fill: string, opacity: number) => `<rect width="144" height="144" fill="${fill}" fill-opacity="${opacity}"/>`;
const META = { size: 16, baseline: 31, right: 129 } as const;
const TITLE = { x: 15, firstBaseline: 82, lineHeight: 20, size: 17 } as const;

export type ThreadKeyInput = {
	state: DeckState;
	title: string;
	/** Top-right text, usually elapsed time. A non-empty `diff` takes its place. */
	meta?: string;
	diff?: { additions: number; deletions: number };
	unseen?: boolean;
	selected?: boolean;
};

/** A thread: state glyph top-left, meta top-right, up to three title lines below. */
export function renderThreadKey(input: ThreadKeyInput): string {
	const parts = [background(input.state === "running" ? COLORS.keyActive : COLORS.key)];
	if (input.state === "approval" || input.state === "question") parts.push(overlay(COLORS.done, 0.25));
	if (input.state === "failed") parts.push(overlay(COLORS.error, 0.2));
	parts.push(glyph(THREAD_GLYPH[input.state], 12, 12, 40));

	const diff = input.diff && (input.diff.additions > 0 || input.diff.deletions > 0) ? input.diff : undefined;
	if (diff) {
		const deletions = `-${diff.deletions}`;
		const additionsRight = Math.round(META.right - textWidth(deletions, META.size) - 8);
		parts.push(
			textEl(`+${diff.additions}`, META.baseline, { x: additionsRight, size: META.size, fill: COLORS.done, anchor: "end" }),
			textEl(deletions, META.baseline, { x: META.right, size: META.size, fill: COLORS.error, anchor: "end" }),
		);
	} else if (input.meta) {
		parts.push(textEl(input.meta, META.baseline, { x: META.right, size: META.size, opacity: 0.5, anchor: "end" }));
	}

	const maxWidth = input.unseen ? 100 : 114;
	parts.push(textBlock(wrapText(input.title, maxWidth, TITLE.size, 3), { ...TITLE, maxWidth }));
	if (input.unseen) parts.push(`<circle cx="119" cy="118" r="4.5" fill="${COLORS.unread}"/>`);
	if (input.selected) parts.push(`<rect x="2" y="2" width="140" height="140" rx="16" fill="none" stroke="#FFFFFF" stroke-width="4"/>`);
	return keySvg(parts.join(""));
}

export type ControlTone = "default" | "approve" | "deny";
export type ControlKeyInput = {
	glyph: GlyphName;
	label?: string;
	/** Primary actions (Send, Stop, Steer) sit in a filled circle. */
	primary?: boolean;
	available?: boolean;
	tone?: ControlTone;
};

const TONE_COLOR: Record<ControlTone, string> = { default: "#FFFFFF", approve: COLORS.done, deny: COLORS.error };
const LABEL = { x: 16.7, lineHeight: 22, size: 20, maxWidth: 112 } as const;

/** A control: a centered glyph alone, or a top-left glyph over a bottom-left label. */
export function renderControlKey(input: ControlKeyInput): string {
	const accent = TONE_COLOR[input.tone ?? "default"];
	const content: string[] = [];
	const label = input.label?.trim();
	if (label) {
		if (input.primary) content.push(`<circle cx="36" cy="33" r="24" fill="${accent}"/>`, glyph(input.glyph, 22, 19, 28, COLORS.key));
		else content.push(glyph(input.glyph, 13, 10, 46, accent));
		const wrapped = wrapText(label, LABEL.maxWidth, LABEL.size, 2);
		content.push(textBlock(wrapped, { ...LABEL, firstBaseline: wrapped.lines.length > 1 ? 101 : 123 }));
	} else if (input.primary) {
		content.push(`<circle cx="72" cy="72" r="47.5" fill="${accent}"/>`, glyph(input.glyph, 50, 50, 44, COLORS.key));
	} else {
		content.push(glyph(input.glyph, 38, 38, 68, accent));
	}
	const body = input.available === false ? `<g opacity=".5">${content.join("")}</g>` : content.join("");
	return keySvg(background(COLORS.key) + body);
}

/** A press's outcome, shown for a moment: a green check with what happened, or a red mark with why not. */
export function renderResultKey(input: { ok: boolean; label: string }): string {
	return renderControlKey(input.ok ? { glyph: "check", tone: "approve", label: input.label } : { glyph: "error", tone: "deny", label: input.label });
}

export type NoticeKeyInput = { glyph: GlyphName; title: string; detail?: string; tone?: "muted" | "attention" };

/** Sign-in, connection and removal notices, laid out like a thread key so they read as native. */
export function renderNoticeKey(input: NoticeKeyInput): string {
	const attention = input.tone === "attention";
	const parts = [background(COLORS.key)];
	if (attention) parts.push(overlay(COLORS.attention, 0.18), glyph(input.glyph, 12, 12, 40, COLORS.attention));
	else parts.push(`<g opacity=".5">${glyph(input.glyph, 12, 12, 40)}</g>`);
	const title = wrapText(input.title, 114, TITLE.size, input.detail ? 2 : 3);
	parts.push(textBlock(title, { ...TITLE, maxWidth: 114 }));
	if (input.detail) {
		const firstBaseline = TITLE.firstBaseline + title.lines.length * TITLE.lineHeight;
		parts.push(textBlock(wrapText(input.detail, 114, 15, 1), { x: TITLE.x, firstBaseline, lineHeight: 18, size: 15, maxWidth: 114, opacity: 0.5 }));
	}
	return keySvg(parts.join(""));
}

/** Touch-strip background: dark navy into violet, with a hairline tinted by state. */
export function stripCanvas(accent: string = COLORS.accent): string {
	return svgDataUrl(
		`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100" viewBox="0 0 200 100"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#121433"/><stop offset="1" stop-color="#241640"/></linearGradient></defs><rect width="200" height="100" fill="url(#g)"/><rect y="97" width="200" height="3" fill="${accent}" fill-opacity=".85"/></svg>`,
	);
}

export function stripIcon(name: GlyphName, color: string = COLORS.text): string {
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">${glyph(name, 1, 1, 36, color)}</svg>`);
}
