import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { modelColor, providerDisplayName, providerMark } from "../core/models.js";
import { COLORS, escapeXml, glyph, type GlyphName, STATE_COLOR, svgMarkup } from "../core/render.js";
import { ringFace } from "../core/ring.js";

// The painters shared keys draw on the Ring live in core now; the Ring's own faces still come from here.
export { effortFace, modeFace, modelFace, ringFace, stopFace, stopTarget } from "../core/ring.js";

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

/** The prompts a ring slot can send, each as its own glyph; Continue is its own action. */
export const PROMPT_GLYPHS = { test: "scriptTest", fix: "hammer", explain: "book", commit: "gitCommit" } as const satisfies Record<string, GlyphName>;

/** Always in full color, so a placed prompt always says which one it is; a press with no thread open just does nothing. */
export const promptFace = (name: keyof typeof PROMPT_GLYPHS): string => ringFace(COLORS.accent, PROMPT_GLYPHS[name]);

/** Continue opens a thread that waits on you, so it wears that thread's approval look then. */
export const continueFace = (step: "open" | "send" | undefined): string =>
	step === "open" ? ringFace(STATE_COLOR.approval, "shield") : ringFace(COLORS.accent, "play", { dim: step === undefined });

export const stopAllFace = (running: number): string => ringFace(COLORS.error, "stop", running > 0 ? { badge: running } : { dim: true });

/**
 * A limit as a ring filling clockwise, in green, amber past 70% and red past 90%, around the gauge glyph, or the mark of
 * the provider `driver` names. No percentage: at the 80 px Options+ draws, it can't be read; the slot's label says it.
 */
export function limitsFace(percent: number | undefined, stale: boolean, driver?: string): string {
	if (percent === undefined) return ringFace(COLORS.muted, "gauge", { dim: true });
	const color = percent >= 90 ? COLORS.error : percent >= 70 ? STATE_COLOR.approval : COLORS.done;
	const radius = 64;
	const length = 2 * Math.PI * radius;
	const used = Math.min(Math.max(percent, 0), 100) / 100;
	const ring =
		`<circle cx="72" cy="72" r="${radius}" fill="none" stroke="${COLORS.muted}" stroke-opacity=".35" stroke-width="10"/>` +
		`<circle cx="72" cy="72" r="${radius}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(length * used).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 72 72)"/>` +
		(driver === undefined ? glyph("gauge", 38, 38, 68, color, 3.2) : providerMarkOf(driver, 28, 88));
	return svgMarkup(144, 144, stale ? `<g opacity=".5">${ring}</g>` : ring);
}

/** A provider's mark, in its color, from its driver alone, as limits know providers. */
function providerMarkOf(driver: string, at: number, size: number): string {
	const provider = { driver, providerName: providerDisplayName({ instanceId: driver, driver }), accentColor: undefined, iconUrl: undefined, badge: false };
	return providerMark(provider, at, at, size, { color: modelColor(provider) ?? COLORS.accent });
}

/** The Limits slot's label: which limit it shows, and how much of it is used. */
export const limitsLabel = (driver: string, window: string, percent: number): string =>
	t("logi.labels.limits", { provider: providerDisplayName({ instanceId: driver, driver }), window, percent: Math.round(percent) });

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

/** A prompt the user wrote in the action's editor, drawn as Stream Deck's Send arrow; dimmed only while it has no text. */
export const customPromptFace = (hasText: boolean): string => ringFace(COLORS.accent, "send", { dim: !hasText });
