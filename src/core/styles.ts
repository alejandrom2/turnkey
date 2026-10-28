/**
 * The touch strip's browse styles beside Elgato's (`strip.ts`): a list wheel on `layouts/list.json` (a heading with a
 * counter, then the previous, selected, next and following item) and a carousel on `layouts/carousel.json` (the item's
 * tile between its dimmed neighbors, its title below). Text stays native where it fits; pictures carry the glyphs,
 * the tiles and any text that scrolls.
 */
import { t } from "./i18n.js";
import { badgeRow, BLANK_ART, COLORS, fadeMask, fit, glyphArt, type MarkPainter, skeletonRect, type StripAppearance, stripCanvas, stripMarkIcon, svgImage, svgText, textWidth, wrapText } from "./render.js";
import { overflowIn, type ScrollLine, scrollLine, type StripContent, slotItems, type TextScroll, type TextSlot } from "./strip.js";

export type StripStyle = "classic" | "list" | "carousel";

export const STRIP_LAYOUTS: Record<StripStyle, string> = { classic: "layouts/strip.json", list: "layouts/list.json", carousel: "layouts/carousel.json" };

const stripStyle = (value: unknown): StripStyle | undefined => (value === "classic" || value === "list" || value === "carousel" ? value : undefined);
const textScroll = (value: unknown): TextScroll | undefined => (value === "horizontal" || value === "vertical" || value === "off" ? value : undefined);

/** A dial's own style and text scroll when it sets them, else the global ones, else the dial's default scrolling sideways. */
export function resolveStripStyle(
	global: { stripStyle?: unknown; textScroll?: unknown },
	dial: { stripStyle?: unknown; textScroll?: unknown } = {},
	fallback: StripStyle = "classic",
): { style: StripStyle; scroll: TextScroll } {
	return {
		style: stripStyle(dial.stripStyle) ?? stripStyle(global.stripStyle) ?? fallback,
		scroll: textScroll(dial.textScroll) ?? textScroll(global.textScroll) ?? "horizontal",
	};
}

export type StripItem = {
	/** Stays the same while the item does, so the carousel knows what it slides to. */
	key: string;
	label: string;
	/** The list's leading glyph and the carousel tile's art. */
	art: MarkPainter;
	/** A short name the carousel writes under the tile, sliding with it, in place of the one title. */
	caption?: string;
	/** Washes the carousel tile, as thread keys tint by state. */
	tint?: string;
	/** The label's color while selected; white by default. */
	color?: string;
	/** More about the item, shown in the reading view. */
	detail?: string;
};

export type StripList = {
	heading: string;
	items: StripItem[];
	index: number;
	/** Turning past the last item comes back to the first. */
	wrap?: boolean;
	/** Takes the list's last row: why the dial can't act, what pressing does, or what an answer is about. */
	note?: { text: string; color?: string };
};

/** A face with nothing to browse as a one-item list: its value, with its detail as the note. */
export const listFromContent = (content: StripContent): StripList => ({
	heading: content.header,
	items: [{ key: "face", label: content.value, art: content.icon }],
	index: 0,
	note: content.detail ? { text: content.detail, color: content.detailColor } : undefined,
});

const mod = (value: number, count: number) => ((value % count) + count) % count;

/** The items a list shows around `index`: previous, selected, next and the one after, none of them twice. */
export function listRows(count: number, index: number, wrap = false): { previous?: number; selected: number; next?: number; after?: number } {
	const used = new Set([index]);
	const at = (offset: number) => {
		const raw = index + offset;
		if (!wrap && (raw < 0 || raw >= count)) return undefined;
		const row = mod(raw, count);
		if (used.has(row)) return undefined;
		used.add(row);
		return row;
	};
	const next = at(1);
	const previous = at(-1);
	return { previous, selected: index, next, after: at(2) };
}

const LIST_SELECTED: TextSlot = { width: 162, height: 20, size: 15, weight: 600, color: "#FFFFFF" };
const CAROUSEL_TITLE: TextSlot = { width: 184, height: 20, size: 15, weight: 700, color: "#FFFFFF" };

/** The item a carousel at `position` shows, or a list selects. */
const shownItem = (list: StripList, position = list.index): StripItem | undefined =>
	list.items.length === 0 ? undefined : list.items[mod(Math.round(position), list.items.length)];

/** The style's line that may scroll: the selected row, or the carousel's title. */
export function styleLine(style: Exclude<StripStyle, "classic">, list: StripList, scroll: TextScroll, position?: number): ScrollLine | undefined {
	const item = shownItem(list, position);
	// Carousel captions are shortened to their column instead of scrolling.
	if (item === undefined || (style === "carousel" && item.caption !== undefined)) return undefined;
	return scrollLine(item.label, style === "list" ? LIST_SELECTED : CAROUSEL_TITLE, scroll, style);
}

type StyleOptions = {
	appearance: StripAppearance;
	scroll: TextScroll;
	/** The scrolling line's offset, in px. */
	offset?: number;
	/** The carousel's position in items, fractional while it slides. */
	position?: number;
	/** The reading view: wrapped lines from `readingLines`, and the first one shown. */
	reading?: { lines: string[]; top: number };
};

type Feedback = Record<string, string | { value: string; color: string }>;

const canvasOf = (content: StripContent, appearance: StripAppearance) =>
	stripCanvas(appearance, content.tone ?? "neutral", content.ultrathink === true);

const svg = (body: string) => svgImage(200, 100, body);

const DIVIDER = `<rect x="8" y="20" width="184" height="1" fill="#FFFFFF" fill-opacity=".12"/>`;
const LIST_ART = svg(DIVIDER);
/** The list's last row as a placeholder bar while it loads. */
const LIST_LOADING_ART = svg(DIVIDER + skeletonRect(30, 81, 96, 12));

const ROW_COLORS = { previous: "#9A9FA8", next: COLORS.secondary, after: "#73787F" } as const;

export const READING = { visible: 4, width: 180, size: 14, lineHeight: 19, firstBaseline: 37 } as const;

/** The reading view's text: each part, and each line of it, wrapped on its own lines. */
export const readingLines = (parts: readonly (string | undefined)[]): string[] =>
	parts.flatMap((part) => (part ?? "").split("\n")).flatMap((part) => (part.trim() ? wrapText(part, READING.width, READING.size, 40).lines : []));

/** What a list's reading view shows: the selected item's label and detail, and the note. */
export const listReading = (list: StripList): string[] => {
	const item = shownItem(list);
	return readingLines([item?.label, item?.detail, list.note?.text]);
};

/** The first line a reading view of `count` lines shows after turning `ticks` from `top`, so a full page stays in view. */
export const scrollReading = (top: number, ticks: number, count: number, visible: number): number => Math.max(0, Math.min(Math.max(0, count - visible), top + ticks));

/** The reading view as a picture over the strip: the heading, four lines from `top`, and where they sit in the text. */
function readingArt(heading: string, lines: readonly string[], top: number): string {
	const shown = lines.slice(top, top + READING.visible);
	const parts = [DIVIDER, svgText(heading, 8, 15, 14, 650, COLORS.text)];
	shown.forEach((line, index) => parts.push(svgText(line, 8, READING.firstBaseline + index * READING.lineHeight, READING.size, 550, "#FFFFFF")));
	if (lines.length > READING.visible) {
		const track = 72;
		const thumb = Math.max(10, Math.round((track * READING.visible) / lines.length));
		const y = 24 + Math.round(((track - thumb) * top) / (lines.length - READING.visible));
		parts.push(`<rect x="194" y="24" width="2" height="${track}" rx="1" fill="#FFFFFF" fill-opacity=".14"/><rect x="194" y="${y}" width="2" height="${thumb}" rx="1" fill="#FFFFFF" fill-opacity=".7"/>`);
	}
	return svg(parts.join(""));
}

const blankRow = { value: "", color: "#FFFFFF" };

export function listFeedback(content: StripContent, list: StripList, options: StyleOptions): Feedback {
	const canvas = canvasOf(content, options.appearance);
	if (options.reading) {
		return {
			canvas,
			heading: "",
			counter: "",
			previous: blankRow,
			glyph: BLANK_ART,
			selected: blankRow,
			selectedArt: BLANK_ART,
			next: blankRow,
			after: blankRow,
			art: readingArt(list.heading, options.reading.lines, options.reading.top),
		};
	}
	const rows = listRows(list.items.length, list.index, list.wrap);
	const label = (index: number | undefined, color: string) => ({ value: index === undefined ? "" : (list.items[index]?.label ?? ""), color });
	const item = list.items[rows.selected];
	const line = styleLine("list", list, options.scroll);
	const selected = slotItems(item?.label ?? "", LIST_SELECTED, item?.color ?? LIST_SELECTED.color, line, options.offset);
	return {
		canvas,
		heading: list.heading,
		counter: list.items.length > 1 ? `${list.index + 1}/${list.items.length}` : "",
		previous: label(rows.previous, ROW_COLORS.previous),
		glyph: item ? stripMarkIcon(item.art, 18) : BLANK_ART,
		selected: selected.text,
		selectedArt: selected.art,
		next: label(rows.next, ROW_COLORS.next),
		after: content.loading ? blankRow : list.note ? { value: list.note.text, color: list.note.color ?? COLORS.muted } : label(rows.after, ROW_COLORS.after),
		art: content.loading ? LIST_LOADING_ART : LIST_ART,
	};
}

const TILE = { center: 68, side: 54, far: 42, gap: 72, cy: 39, radius: 12 } as const;

/** A tile's name on the strip's bottom row, under `cx`: bolder and wider at the center, shortened to fit its column. */
function tileCaption(text: string, cx: number, faded: number, color: string): string {
	const size = 14 - 3 * faded;
	return svgText(fit(text, 84 - 20 * faded, size), cx, 92, size, faded < 0.5 ? 700 : 600, color, ` text-anchor="middle"`);
}

/** One tile `distance` items from the center: smaller, dimmer and without the white border the further it is. */
function tile(item: StripItem, distance: number): string {
	const away = Math.abs(distance);
	const size = away <= 1 ? TILE.center - (TILE.center - TILE.side) * away : TILE.side - (TILE.side - TILE.far) * Math.min(1, away - 1);
	const cx = 100 + distance * TILE.gap;
	const x = cx - size / 2;
	const y = TILE.cy - size / 2;
	const art = Math.round(size * 0.5);
	const box = (extra: string) => `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${TILE.radius}" ${extra}/>`;
	const body = box(`fill="#26282E"`) + (item.tint ? box(`fill="${item.tint}" fill-opacity=".24"`) : "") + item.art(cx - art / 2, TILE.cy - art / 2, art);
	const faded = Math.min(1, away);
	const border = away < 1 ? box(`fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-opacity="${(1 - faded).toFixed(2)}"`) : "";
	const caption = item.caption === undefined ? "" : tileCaption(item.caption, cx, faded, away < 0.5 ? (item.color ?? "#FFFFFF") : COLORS.secondary);
	return `<g opacity="${(1 - 0.55 * faded).toFixed(2)}">${body}${caption}</g>${border}`;
}

/** The tiles around `position`, nearest drawn last so the center sits on top. */
export function carouselTiles(list: StripList, position: number): string {
	const count = list.items.length;
	const cycles = list.wrap === true && count >= 3;
	const tiles: { distance: number; item: StripItem }[] = [];
	for (let index = Math.floor(position) - 2; index <= Math.ceil(position) + 2; index++) {
		const distance = index - position;
		if (Math.abs(distance) >= 2 || (!cycles && (index < 0 || index >= count))) continue;
		tiles.push({ distance, item: list.items[mod(index, count)]! });
	}
	tiles.sort((a, b) => Math.abs(b.distance) - Math.abs(a.distance));
	return tiles.map(({ item, distance }) => tile(item, distance)).join("");
}

export function carouselFeedback(content: StripContent, list: StripList, options: StyleOptions): Feedback {
	const canvas = canvasOf(content, options.appearance);
	if (options.reading) return { canvas, art: readingArt(list.heading, options.reading.lines, options.reading.top), title: blankRow, titleArt: BLANK_ART };
	const position = options.position ?? list.index;
	const item = shownItem(list, position);
	if (item?.caption !== undefined) return { canvas, art: svg(carouselTiles(list, position)), title: blankRow, titleArt: BLANK_ART };
	const line = styleLine("carousel", list, options.scroll, position);
	const title = slotItems(item?.label ?? "", CAROUSEL_TITLE, item?.color ?? CAROUSEL_TITLE.color, line, options.offset);
	return { canvas, art: svg(carouselTiles(list, position)), title: title.text, titleArt: title.art };
}

/** A press result in a browse style: a check or a mark with what happened, wrapped when it is long. */
export function styleFlash(style: Exclude<StripStyle, "classic">, ok: boolean, label: string, appearance: StripAppearance): Feedback {
	const color = ok ? COLORS.done : COLORS.error;
	const content: StripContent = { header: ok ? t("strip.done") : t("strip.notNow"), icon: glyphArt(ok ? "check" : "error", color), value: label, tone: ok ? "done" : "failed" };
	if (style === "list") {
		const [first = "", second = "", third = ""] = wrapText(label, LIST_SELECTED.width, LIST_SELECTED.size, 3).lines;
		return {
			...listFeedback(content, { heading: content.header, items: [{ key: "flash", label: first, art: content.icon }], index: 0 }, { appearance, scroll: "off" }),
			next: { value: second, color: "#FFFFFF" },
			after: { value: third, color: "#FFFFFF" },
		};
	}
	const list: StripList = { heading: content.header, items: [{ key: "flash", label, art: content.icon, tint: color }], index: 0 };
	if (overflowIn(label, CAROUSEL_TITLE) === 0) return carouselFeedback(content, list, { appearance, scroll: "off" });
	return carouselFeedback(content, list, { appearance, scroll: "off", reading: { lines: readingLines([label]), top: 0 } });
}

/** `queued` and `subagents` draw the first row's queue ("+N") and running subagents at its right. */
type ThreadRow = { title: string; art: MarkPainter; queued?: number; subagents?: number };

const ROWS = [
	{ baseline: 31, size: 19, weight: 700, fill: "#FFFFFF", width: 184 },
	{ baseline: 61, size: 17, weight: 600, fill: COLORS.faint, width: 146 },
	{ baseline: 89, size: 17, weight: 600, fill: COLORS.faint, width: 146 },
] as const;

/**
 * Elgato's thread strip: the selected title large on top, the next two dimmed below with their status at the right.
 * Titles too long for their row fade out at its end.
 */
export function threadRowsArt(rows: readonly ThreadRow[]): string {
	const parts: string[] = [];
	rows.slice(0, 3).forEach((row, at) => {
		const line = ROWS[at]!;
		const badges = at === 0 ? badgeRow(row.queued, row.subagents, 192, line.baseline - 16) : { svg: "", right: 192 };
		const width = badges.svg ? Math.min(line.width, badges.right - 16) : line.width;
		let text = svgText(row.title, 12, line.baseline, line.size, line.weight, line.fill);
		if (textWidth(row.title, line.size, line.weight) > width - 2) {
			const end = 12 + width;
			parts.push(fadeMask(`row-${at}`, end - 24, end, { y: line.baseline - line.size - 4, width: 200, height: line.size + 10 }));
			text = `<g mask="url(#row-${at})">${text}</g>`;
		}
		parts.push(text + badges.svg);
		if (at > 0) parts.push(row.art(168, line.baseline - 16, 20));
	});
	return svg(parts.join(""));
}
