import type { DeckThread } from "../core/board.js";
import { COLORS, glyph, type GlyphName, STATE_COLOR, svgImage } from "../core/render.js";

/** What the Actions Ring reads from a thread. */
type RingThread = Pick<DeckThread, "deck" | "unseen">;

/**
 * The ring draws its own disc behind each slot, white and black on hover, so a face is just one glyph in the action's
 * color, drawn heavy enough for both, plus a count when one matters.
 */
export function ringFace(color: string, name: GlyphName, options: { badge?: number | string; dim?: boolean } = {}): string {
	const mark = glyph(name, 42, 42, 60, options.dim ? COLORS.muted : color, 3);
	const badge =
		options.badge === undefined
			? ""
			: `<circle cx="108" cy="36" r="20" fill="${COLORS.key}"/><text x="108" y="44" font-size="24" font-weight="700" text-anchor="middle" fill="${COLORS.text}">${options.badge}</text>`;
	return svgImage(144, 144, (options.dim ? `<g opacity=".6">${mark}</g>` : mark) + badge);
}

const waiting = (deck: DeckThread["deck"]) => deck === "approval" || deck === "question";

/** The board's first thread is the most urgent: what waits on you (and how many), work in progress, a failure you haven't seen, or all done. */
export function urgentFace(threads: readonly RingThread[]): string {
	const top = threads[0];
	const count = threads.filter((thread) => waiting(thread.deck)).length;
	const badge = count > 9 ? "9+" : count > 1 ? count : undefined;
	switch (top?.deck) {
		case "approval":
			return ringFace(STATE_COLOR.approval, "shield", { badge });
		case "question":
			return ringFace(STATE_COLOR.question, "question", { badge });
		case "running":
			return ringFace(STATE_COLOR.running, "pulse");
		case "failed":
			if (top.unseen) return ringFace(STATE_COLOR.failed, "error");
	}
	// A spark, not a check: on the ring a check reads as approving something.
	return ringFace(STATE_COLOR.done, "spark");
}

/** The board lists running threads newest first, so this is the run that started last. */
export const stopTarget = <T extends Pick<DeckThread, "deck">>(threads: readonly T[]): T | undefined => threads.find((thread) => thread.deck === "running");

export const stopFace = (available: boolean): string => ringFace(COLORS.accent, "stop", { dim: !available });
