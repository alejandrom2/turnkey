/**
 * Faces for Stream Deck Neo's info bar: one 232 × 50 picture between the page buttons, drawn like a strip row. Activity
 * shows the most urgent thread and how many wait on you or work; Usage shows a period's cost.
 */
import type { DeckState } from "./board.js";
import { elapsed, type MessageKey, t } from "./i18n.js";
import { fit } from "./slider.js";
import { COLORS, fitSize, glyph, type GlyphName, type MarkPainter, STATE_COLOR, STATE_GLYPH, svgDataUrl, svgText, textWidth } from "./render.js";

export const INFOBAR = { width: 232, height: 50, layout: "layouts/infobar.json" } as const;

const bar = (body: string) =>
	svgDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="${INFOBAR.width}" height="${INFOBAR.height}" viewBox="0 0 ${INFOBAR.width} ${INFOBAR.height}"><rect width="${INFOBAR.width}" height="${INFOBAR.height}" fill="${COLORS.key}"/>${body}</svg>`);

/** The left tile: a glyph (or a provider mark) on a faint wash of its color. */
function tile(icon: { glyph: GlyphName; color: string } | MarkPainter, wash: string | undefined): string {
	const box = `<rect x="8" y="8" width="34" height="34" rx="8" fill="${wash ?? "#FFFFFF"}" fill-opacity="${wash ? 0.18 : 0.08}"/>`;
	return box + (typeof icon === "function" ? icon(14, 14, 22) : glyph(icon.glyph, 14, 14, 22, icon.color));
}

export type ThreadCounts = { approval: number; question: number; running: number };

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

export type ActivityBarInput =
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

export type UsageBarInput = {
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
		room -= textWidth(value, size) * 1.1 + 8;
	}
	parts.push(svgText(fit(input.label, room, 15), x, 22, 15, 650, input.available === false ? COLORS.muted : COLORS.text));
	parts.push(svgText(fit(input.detail, room, 13), x, 40, 13, 600, COLORS.muted));
	return bar(parts.join(""));
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
