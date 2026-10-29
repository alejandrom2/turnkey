import type { DeckState, DeckThread } from "../board.js";
import { t } from "../i18n.js";
import { QUICK_PROMPTS } from "../prompts.js";
import { COLORS, renderControlKey, renderInfoKey, STATE_COLOR } from "../render.js";
import type { KeyRuntime } from "./key.js";
import { stateAt, threadTile } from "./threads.js";

// The MX Keypad tiles of Logitech actions with no Stream Deck key of their own, drawn as their nearest Stream Deck key.

/**
 * Activity's face for the thread a press opens (Most urgent, Waiting, Running), or All quiet without one. It always
 * wears the selected look, as Activity's own key does, and counts what the Ring's glyph badges.
 */
export function activityTile(runtime: KeyRuntime, thread: DeckThread | undefined, tally?: { count: number; color: string }): string {
	const ctx = { settings: {}, machine: undefined, runtime, target: () => ({ thread, pinned: false }) };
	return threadTile({ ...stateAt(ctx, thread === undefined ? [] : [thread], 0), selected: thread }, ctx, t("face.allQuiet"), tally);
}

/** What waits on you, in amber, else what runs, in blue, as the Ring's Status glyph colors them, counted in words. */
export function statusTile(counts: { approval: number; question: number; running: number }): string {
	const waiting = counts.approval + counts.question;
	const color = waiting > 0 ? STATE_COLOR.approval : counts.running > 0 ? STATE_COLOR.running : COLORS.muted;
	return renderInfoKey({ glyph: "queued", color, title: t("logi.labels.status", { waiting, running: counts.running }), available: waiting + counts.running > 0 });
}

/** Quick Prompt's Continue; a thread that waits on you is opened instead, so the key wears its approval or question look then. */
export function continueTile(step: "open" | "send" | undefined, deck?: DeckState): string {
	const label = t(QUICK_PROMPTS.continue.label);
	if (step === "open" && deck === "question") return renderControlKey({ glyph: "question", primary: true, glyphColor: STATE_COLOR.question, label });
	if (step === "open") return renderControlKey({ glyph: "shield", primary: true, glyphColor: STATE_COLOR.approval, label });
	return renderControlKey({ glyph: "spark", primary: true, label, available: step !== undefined });
}

/** Stop's tile in the Ring's red with how many runs it stops, dim while nothing runs. */
export const stopAllTile = (running: number): string =>
	renderControlKey({ glyph: "stop", primary: true, glyphColor: COLORS.error, label: running > 0 ? String(running) : undefined, available: running > 0 });

export const settingsTile = (): string => renderControlKey({ glyph: "sliders" });
