/**
 * Faces for Stream Deck Neo's info bar: one 232 × 50 picture between the page buttons, drawn like a strip row. Activity
 * shows the most urgent thread and how many wait on you or work; Usage shows a period's cost. Model, Git, Pull Request,
 * Limits and Send Prompt show their key's subject, so each page of a profile can bring its own bar.
 */
import type { DeckState } from "./board.js";
import { elapsed, type MessageKey, t } from "./i18n.js";
import { COLORS, fit, fitSize, glyph, type GlyphName, type MarkPainter, STATE_COLOR, STATE_GLYPH, svgImage, svgText, textWidth } from "./render.js";

export const INFOBAR = { width: 232, height: 50, layout: "layouts/infobar.json" } as const;

const bar = (body: string) => svgImage(INFOBAR.width, INFOBAR.height, `<rect width="${INFOBAR.width}" height="${INFOBAR.height}" fill="${COLORS.key}"/>${body}`);

/** The left tile: a glyph (or a provider mark) on a faint wash of its color. */
function tile(icon: { glyph: GlyphName; color: string } | MarkPainter, wash: string | undefined): string {
	const box = `<rect x="8" y="8" width="34" height="34" rx="8" fill="${wash ?? "#FFFFFF"}" fill-opacity="${wash ? 0.18 : 0.08}"/>`;
	return box + (typeof icon === "function" ? icon(14, 14, 22) : glyph(icon.glyph, 14, 14, 22, icon.color));
}

type ThreadCounts = { approval: number; question: number; running: number };

/** How many threads wait on an approval or an answer, and how many work: the info bar's chips. */
export function threadCounts(threads: readonly { deck: DeckState }[]): ThreadCounts {
	const counts: ThreadCounts = { approval: 0, question: 0, running: 0 };
	for (const { deck } of threads) {
		if (deck === "approval") counts.approval++;
		else if (deck === "question") counts.question++;
		else if (deck === "running") counts.running++;
	}
	return counts;
}

/** Chips right-aligned at `right`: a dot in the state's color and the count. Returns the svg and the room they take. */
function chips(counts: ThreadCounts, right: number, baseline: number): { svg: string; width: number } {
	const parts: string[] = [];
	let x = right;
	for (const state of ["running", "question", "approval"] as const) {
		const count = counts[state];
		if (count === 0) continue;
		const text = String(count);
		const width = textWidth(text, 14);
		parts.push(svgText(text, x, baseline, 14, 650, COLORS.text, ` text-anchor="end"`));
		x -= width + 5;
		parts.push(`<circle cx="${x - 3}" cy="${baseline - 5}" r="3.5" fill="${STATE_COLOR[state]}"/>`);
		x -= 14;
	}
	return { svg: parts.join(""), width: right - x };
}

type ActivityBarInput =
	| { kind: "thread"; state: DeckState; title: string; detail: string; counts: ThreadCounts }
	| { kind: "empty"; label: string; counts: ThreadCounts };

export type BarNotice = { glyph: GlyphName; title: string; detail: string; tone: "muted" | "attention" };

/** Why the bar can't show its figures yet: not connected, not paired, missing access. */
export function renderNoticeBar(notice: BarNotice): string {
	const x = 52;
	const right = INFOBAR.width - 10;
	const attention = notice.tone === "attention";
	return bar(
		tile({ glyph: notice.glyph, color: attention ? COLORS.attention : COLORS.muted }, attention ? COLORS.attention : undefined) +
			svgText(fit(notice.title, right - x, 15), x, 22, 15, 650, COLORS.text) +
			svgText(fit(notice.detail, right - x, 13), x, 40, 13, 600, COLORS.muted),
	);
}

export function renderActivityBar(input: ActivityBarInput): string {
	const x = 52;
	const right = INFOBAR.width - 10;
	const empty = input.kind === "empty";
	const counts = chips(input.counts, right, empty ? 31 : 22);
	const room = right - x - (counts.width > 0 ? counts.width + 6 : 0);
	if (input.kind === "empty") return bar(tile({ glyph: "chat", color: COLORS.muted }, undefined) + svgText(fit(input.label, room, 15), x, 31, 15, 650, COLORS.muted) + counts.svg);
	const color = STATE_COLOR[input.state];
	const tinted = input.state === "approval" || input.state === "question" || input.state === "failed" || input.state === "done";
	return bar(
		tile({ glyph: STATE_GLYPH[input.state], color }, tinted ? color : undefined) +
			svgText(fit(input.title, room, 15), x, 22, 15, 650, COLORS.text) +
			counts.svg +
			svgText(fit(input.detail, right - x, 13), x, 40, 13, 600, tinted ? color : COLORS.muted),
	);
}

type UsageBarInput = {
	mark?: MarkPainter;
	label: string;
	/** The big figure on the right: the period's cost. */
	value?: string;
	detail: string;
	/** Loading or stale: the figure is drawn faded. */
	dim?: boolean;
	available?: boolean;
};

export function renderUsageBar(input: UsageBarInput): string {
	const x = 52;
	const right = INFOBAR.width - 10;
	const parts = [tile(input.mark ?? { glyph: "usage", color: input.available === false ? COLORS.muted : COLORS.text }, undefined)];
	let room = right - x;
	if (input.value !== undefined) {
		const size = fitSize(input.value, 96, [24, 21, 18, 15]);
		const value = fit(input.value, 96, size);
		parts.push(`<g${input.dim ? ` opacity=".45"` : ""}>${svgText(value, right, 33, size, 700, "#FFFFFF", ` text-anchor="end"`)}</g>`);
		room -= textWidth(value, size, 700) + 8;
	}
	parts.push(svgText(fit(input.label, room, 15), x, 22, 15, 650, input.available === false ? COLORS.muted : COLORS.text));
	parts.push(svgText(fit(input.detail, room, 13), x, 40, 13, 600, COLORS.muted));
	return bar(parts.join(""));
}

type InfoBarInput = {
	icon: { glyph: GlyphName; color: string } | MarkPainter;
	/** Tints the icon's tile, as Activity does for a thread that needs you. */
	wash?: string;
	title: string;
	detail: string;
	detailColor?: string;
	/** Right of the title: a short word (Held, #19) or a glyph (Fast's bolt), in its color. */
	right?: { text: string; color: string } | { glyph: GlyphName; color: string };
	available?: boolean;
};

/** A titled bar with a detail line, for the bars that follow a key: Model, Git, Pull Request and Send Prompt. */
export function renderInfoBar(input: InfoBarInput): string {
	const x = 52;
	const right = INFOBAR.width - 10;
	const muted = input.available === false;
	let room = right - x;
	let side = "";
	if (input.right && "text" in input.right) {
		const width = textWidth(input.right.text, 14, 700);
		side = svgText(input.right.text, right, 22, 14, 700, input.right.color, ` text-anchor="end"`);
		room -= width + 8;
	} else if (input.right) {
		side = glyph(input.right.glyph, right - 16, 9, 16, input.right.color);
		room -= 24;
	}
	return bar(
		tile(muted ? { glyph: typeof input.icon === "function" ? "cube" : input.icon.glyph, color: COLORS.muted } : input.icon, muted ? undefined : input.wash) +
			svgText(fit(input.title, room, 15), x, 22, 15, 650, muted ? COLORS.muted : COLORS.text) +
			side +
			svgText(fit(input.detail, right - x, 13), x, 40, 13, 600, input.detailColor ?? COLORS.muted),
	);
}

type LimitBarInput = {
	mark?: MarkPainter;
	label: string;
	/** Shown as is: left or used, as the Limits setting says. */
	percent: number;
	/** How full the window is, 0–1, which sets the color: green, amber from 60%, red from 80%. */
	used: number;
	/** Where even pace would put the bar, 0–1, on the same scale as `percent`. */
	pace?: number;
	detail: string;
	dim?: boolean;
};

/** Limits on the info bar: the window and its percent, a bar with the pace marker, and when it resets. */
export function renderLimitBar(input: LimitBarInput): string {
	const x = 52;
	const right = INFOBAR.width - 10;
	const track = right - x;
	const color = input.used >= 0.8 ? COLORS.error : input.used >= 0.6 ? COLORS.attention : COLORS.done;
	const value = `${input.percent}%`;
	const filled = Math.round((track * Math.min(Math.max(input.percent, 0), 100)) / 100);
	const marker = input.pace === undefined ? "" : `<rect x="${Math.round(x + track * input.pace) - 1}" y="25" width="2" height="8" rx="1" fill="${COLORS.text}"/>`;
	return bar(
		tile(input.mark ?? { glyph: "gauge", color }, undefined) +
			`<g${input.dim ? ` opacity=".45"` : ""}>` +
			svgText(fit(input.label, track - textWidth(value, 15, 700) - 8, 15), x, 20, 15, 650, COLORS.text) +
			svgText(value, right, 20, 15, 700, color, ` text-anchor="end"`) +
			`<rect x="${x}" y="27" width="${track}" height="4" rx="2" fill="${COLORS.dim}"/><rect x="${x}" y="27" width="${filled}" height="4" rx="2" fill="${color}"/>${marker}` +
			`</g>` +
			svgText(fit(input.detail, track, 12), x, 45, 12, 600, COLORS.muted),
	);
}

const STATUS: Record<DeckState, MessageKey> = {
	approval: "status.needsApproval",
	question: "status.hasQuestion",
	running: "status.running",
	queued: "status.queued",
	done: "status.done",
	failed: "status.failed",
	stopped: "status.stopped",
	idle: "status.idle",
};

type BarThread = { deck: DeckState; title: string; activeSince?: number; projectTitle?: string };

/** Activity's info bar: the first of `matching` (most urgent first) with its state, and counts across `all` threads. */
export function activityBar(matching: readonly BarThread[], all: readonly { deck: DeckState }[], emptyLabel: string, now: number): ActivityBarInput {
	const counts = threadCounts(all);
	const [top] = matching;
	if (top === undefined) return { kind: "empty", label: emptyLabel, counts };
	const status = t(STATUS[top.deck], { time: elapsed(top.activeSince, now) }).trim();
	const detail = top.projectTitle ? `${status} · ${top.projectTitle}` : status;
	return { kind: "thread", state: top.deck, title: top.title, detail, counts };
}
