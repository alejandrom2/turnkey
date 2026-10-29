import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { COLORS, escapeXml, glyph, STATE_COLOR, svgMarkup } from "../core/render.js";
import { ringFace } from "../core/ring.js";

// The painters shared keys draw on the Ring live in core now; the Ring's own faces still come from here.
export { customPromptFace, effortFace, limitsFace, limitsLabel, modeFace, modelFace, PROMPT_GLYPHS, promptFace, ringFace, stopFace, stopTarget } from "../core/ring.js";

/** What the Actions Ring reads from a thread. */
type RingThread = Pick<DeckThread, "deck" | "unseen">;

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



export const settingsFace = (): string => ringFace(COLORS.accent, "sliders");

/** A press's outcome on the ring: a check or a mark. The label goes with it as the slot's name, since 80 px can't carry text. */
export const glyphResult = (ok: boolean, label: string): string =>
	svgMarkup(144, 144, `<title>${escapeXml(label)}</title>` + glyph(ok ? "check" : "error", 28, 28, 88, ok ? COLORS.done : COLORS.error, 3.2));

/** Continue opens a thread that waits on you, so it wears that thread's approval look then. */
export const continueFace = (step: "open" | "send" | undefined): string =>
	step === "open" ? ringFace(STATE_COLOR.approval, "shield") : ringFace(COLORS.accent, "play", { dim: step === undefined });

export const stopAllFace = (running: number): string => ringFace(COLORS.error, "stop", running > 0 ? { badge: running } : { dim: true });

/** What waits on you, in amber, else what runs, in blue, counted on the badge; the label gives both. */
export function statusFace(counts: { approval: number; question: number; running: number }): string {
	const waiting = counts.approval + counts.question;
	if (waiting > 0) return ringFace(STATE_COLOR.approval, "queued", { badge: counted(waiting) });
	if (counts.running > 0) return ringFace(STATE_COLOR.running, "queued", { badge: counted(counts.running) });
	return ringFace(COLORS.muted, "queued", { dim: true });
}

const counted = (count: number) => (count > 9 ? "9+" : count);

/** The Threads folder's half for what waits on you: approvals and questions, in T3 Code's amber. */
export function waitingFace(threads: readonly RingThread[]): string {
	const count = threads.filter((thread) => waiting(thread.deck)).length;
	return count > 0 ? ringFace(STATE_COLOR.approval, "shield", { badge: counted(count) }) : ringFace(COLORS.muted, "shield", { dim: true });
}

/** The Threads folder's half for what runs, in blue. */
export function runningFace(threads: readonly RingThread[]): string {
	const count = threads.filter((thread) => thread.deck === "running").length;
	return count > 0 ? ringFace(STATE_COLOR.running, "pulse", { badge: counted(count) }) : ringFace(COLORS.muted, "pulse", { dim: true });
}

export const statusLabel = (counts: { approval: number; question: number; running: number }): string =>
	t("logi.labels.status", { waiting: counts.approval + counts.question, running: counts.running });
