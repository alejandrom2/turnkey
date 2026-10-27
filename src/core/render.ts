import type { DeckState } from "./board.js";

/** Palette follows the native Stream Deck agent style: flat near-black keys, white line glyphs, one status accent. */
export const COLORS = {
	key: "#111111",
	text: "#F5F7FB",
	muted: "#8A8F98",
	done: "#40C977",
	error: "#FF6764",
	attention: "#FF8549",
	accent: "#5B8CFF",
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

/** 20×20 line glyphs, drawn for this plugin. Stroke colour comes from the caller. */
const GLYPHS = {
	chat: `<path d="M4 4.5h12a1.5 1.5 0 0 1 1.5 1.5v7a1.5 1.5 0 0 1-1.5 1.5H9l-4 3v-3H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5z"/>`,
	stop: `<rect x="5" y="5" width="10" height="10" rx="2"/>`,
	send: `<path d="M10 16V4M5 9l5-5 5 5"/>`,
	plus: `<path d="M10 4v12M4 10h12"/>`,
	check: `<circle cx="10" cy="10" r="7.5"/><path d="M6.5 10.2l2.4 2.4 4.6-4.9"/>`,
	error: `<circle cx="10" cy="10" r="7.5"/><path d="M10 6v5M10 13.6v.1"/>`,
	question: `<circle cx="10" cy="10" r="7.5"/><path d="M7.8 8a2.3 2.3 0 1 1 3.2 2.1c-.7.3-1 .8-1 1.5M10 14.2v.1"/>`,
	shield: `<path d="M10 2.5l6 2.3v4.6c0 3.8-2.6 6.7-6 8.1-3.4-1.4-6-4.3-6-8.1V4.8z"/><path d="M10 7v3.5M10 12.8v.1"/>`,
	clock: `<circle cx="10" cy="10" r="7.5"/><path d="M10 5.8V10l2.8 1.8"/>`,
	running: `<circle cx="10" cy="10" r="7.5" stroke="#3A3D44"/><path d="M10 2.5a7.5 7.5 0 0 1 7.5 7.5"/>`,
	pause: `<circle cx="10" cy="10" r="7.5"/><path d="M8.2 7.3v5.4M11.8 7.3v5.4"/>`,
	idle: `<circle cx="10" cy="10" r="7.5"/>`,
	cube: `<path d="M10 2.8l6.3 3.6v7.2L10 17.2l-6.3-3.6V6.4z"/><path d="M3.7 6.4L10 10l6.3-3.6M10 10v7.2"/>`,
	sliders: `<path d="M4 6h6M14 6h2M4 14h2M10 14h6"/><circle cx="12" cy="6" r="2"/><circle cx="8" cy="14" r="2"/>`,
	spark: `<path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z"/>`,
	pin: `<path d="M7 3.5h6M8 3.5v4.2L5.5 11h9L12 7.7V3.5M10 11v5.5"/>`,
	moon: `<path d="M15.5 12.2A6.5 6.5 0 0 1 7.8 4.5a6.5 6.5 0 1 0 7.7 7.7z"/>`,
	archive: `<rect x="3" y="4" width="14" height="3.5" rx="1"/><path d="M4.5 7.5V15a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V7.5M8 10.5h4"/>`,
	settle: `<path d="M3.5 10.5l3.5 3.5 6.5-7M9.5 13.5l.5.5 6.5-7"/>`,
	key: `<circle cx="7" cy="10" r="3.5"/><path d="M10.5 10h7M15 10v2.5M17.5 10v2"/>`,
	plug: `<path d="M7 3v4M13 3v4M5 7h10v2.5a5 5 0 0 1-10 0zM10 14.5V17"/>`,
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

const FONT = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif"`;

const escapeXml = (text: string) =>
	text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

export const svgDataUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

export function glyph(name: GlyphName, x: number, y: number, size: number, color: string = COLORS.text): string {
	const scale = size / 20;
	return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="${(1.4).toFixed(2)}" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[name]}</g>`;
}

/** Greedy word wrap by an average glyph width, then ellipsis on the last line. */
export function wrap(text: string, maxChars: number, maxLines: number): string[] {
	const words = text.trim().split(/\s+/).filter(Boolean);
	const lines: string[] = [];
	let line = "";
	for (const word of words) {
		const next = line ? `${line} ${word}` : word;
		if (next.length <= maxChars) {
			line = next;
			continue;
		}
		if (line) lines.push(line);
		line = word.length > maxChars ? `${word.slice(0, maxChars - 1)}…` : word;
		if (lines.length === maxLines) break;
	}
	if (line && lines.length < maxLines) lines.push(line);
	if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
		const last = lines[maxLines - 1];
		lines[maxLines - 1] = last.length >= maxChars ? `${last.slice(0, maxChars - 1)}…` : `${last}…`;
	}
	return lines;
}

export const elapsed = (since: number | undefined, now: number): string => {
	if (since === undefined) return "";
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes >= 60 ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}` : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

export type KeyFace = {
	glyph: GlyphName;
	color?: string;
	label?: string;
	detail?: string;
	/** Small badge in the top-right corner, e.g. an unseen dot. */
	badge?: string;
	dimmed?: boolean;
};

/** 144×144 key: centered glyph alone, or glyph with up to two label lines and a detail line. */
export function renderKey(face: KeyFace): string {
	const color = face.dimmed ? COLORS.dim : (face.color ?? COLORS.text);
	const textColor = face.dimmed ? COLORS.dim : COLORS.text;
	const lines = face.label ? wrap(face.label, 11, 2) : [];
	const hasText = lines.length > 0 || Boolean(face.detail);
	const parts = [`<rect width="144" height="144" fill="${COLORS.key}"/>`];
	parts.push(hasText ? glyph(face.glyph, 50, 16, 44, color) : glyph(face.glyph, 40, 40, 64, color));
	lines.forEach((line, index) =>
		parts.push(`<text x="72" y="${82 + index * 22}" ${FONT} font-size="19" font-weight="700" fill="${textColor}" text-anchor="middle">${escapeXml(line)}</text>`),
	);
	if (face.detail) {
		parts.push(`<text x="72" y="134" ${FONT} font-size="16" font-weight="600" fill="${COLORS.muted}" text-anchor="middle">${escapeXml(face.detail)}</text>`);
	}
	if (face.badge) parts.push(`<circle cx="124" cy="20" r="8" fill="${face.badge}"/>`);
	return svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">${parts.join("")}</svg>`);
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
