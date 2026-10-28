import type { DeckThread } from "../core/board.js";
import { COLORS, glyph, type GlyphName, STATE_COLOR, svgImage } from "../core/render.js";

/** What the Actions Ring reads from a thread. */
type RingThread = Pick<DeckThread, "deck" | "unseen">;

/**
 * A ring slot is a thumbnail, so a face is one disc in the action's color and one big glyph, with no text but a count.
 * The corners stay transparent so it sits on the ring as a disc.
 */
export function ringFace(color: string, name: GlyphName, options: { badge?: number | string; dim?: boolean } = {}): string {
	const disc = `<circle cx="72" cy="72" r="64" fill="${options.dim ? COLORS.muted : color}"${options.dim ? ` fill-opacity=".35"` : ""}/>`;
	const mark = glyph(name, 36, 36, 72, COLORS.key, 2.6);
	const badge =
		options.badge === undefined
			? ""
			: `<circle cx="116" cy="28" r="22" fill="${COLORS.key}"/><text x="116" y="37" font-size="26" font-weight="700" text-anchor="middle" fill="${COLORS.text}">${options.badge}</text>`;
	return svgImage(144, 144, disc + (options.dim ? `<g opacity=".5">${mark}</g>` : mark) + badge);
}

const waiting = (deck: DeckThread["deck"]) => deck === "approval" || deck === "question";

/** The board's first thread is the most urgent; the face says what it needs and how many threads wait on you. */
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
			return ringFace(STATE_COLOR.running, "running");
		case "failed":
			if (top.unseen) return ringFace(STATE_COLOR.failed, "error");
			break;
		case "done":
			if (top.unseen) return ringFace(STATE_COLOR.done, "checkBare");
			break;
	}
	return ringFace(COLORS.muted, "checkBare");
}

/** The board lists running threads newest first, so this is the run that started last. */
export const stopTarget = <T extends Pick<DeckThread, "deck">>(threads: readonly T[]): T | undefined => threads.find((thread) => thread.deck === "running");

export const stopFace = (available: boolean): string => ringFace(COLORS.accent, "stop", { dim: !available });
