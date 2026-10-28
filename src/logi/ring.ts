import type { DeckThread } from "../core/board.js";
import { COLORS, glyph, type GlyphName, MODE_GLYPH, STATE_COLOR, svgMarkup } from "../core/render.js";
import type { RuntimeMode } from "../core/t3/shell.js";

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
	return svgMarkup(144, 144, (options.dim ? `<g opacity=".6">${mark}</g>` : mark) + badge);
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


export const settingsFace = (): string => ringFace(COLORS.accent, "sliders");

/** The prompts a ring slot can send, each as its own glyph; Continue is its own action. */
export const PROMPT_GLYPHS = { test: "scriptTest", fix: "hammer", explain: "book", commit: "gitCommit" } as const satisfies Record<string, GlyphName>;

export const promptFace = (name: keyof typeof PROMPT_GLYPHS, available: boolean): string => ringFace(COLORS.accent, PROMPT_GLYPHS[name], { dim: !available });

/** Continue opens a thread that waits on you, so it wears that thread's approval look then. */
export const continueFace = (step: "open" | "send" | undefined): string =>
	step === "open" ? ringFace(STATE_COLOR.approval, "shield") : ringFace(COLORS.accent, "play", { dim: step === undefined });

export const stopAllFace = (running: number): string => ringFace(COLORS.error, "stop", running > 0 ? { badge: running } : { dim: true });

/** The tightest limit as a ring filling clockwise, in green, amber past 70% and red past 90%, around its percentage. */
export function limitsFace(percent: number | undefined, stale: boolean): string {
	if (percent === undefined) return ringFace(COLORS.muted, "gauge", { dim: true });
	const color = percent >= 90 ? COLORS.error : percent >= 70 ? STATE_COLOR.approval : COLORS.done;
	const radius = 52;
	const length = 2 * Math.PI * radius;
	const used = Math.min(Math.max(percent, 0), 100) / 100;
	const ring =
		`<circle cx="72" cy="72" r="${radius}" fill="none" stroke="${COLORS.muted}" stroke-opacity=".35" stroke-width="12"/>` +
		`<circle cx="72" cy="72" r="${radius}" fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(length * used).toFixed(1)} ${length.toFixed(1)}" transform="rotate(-90 72 72)"/>` +
		`<text x="72" y="88" font-size="44" font-weight="700" text-anchor="middle" fill="${color}">${Math.round(percent)}</text>`;
	return svgMarkup(144, 144, stale ? `<g opacity=".5">${ring}</g>` : ring);
}

/** What waits on you, in amber, over what runs, in blue. */
export function statusFace(counts: { approval: number; question: number; running: number }): string {
	const figure = (value: number, y: number, color: string) => `<text x="72" y="${y}" font-size="50" font-weight="700" text-anchor="middle" fill="${color}">${value}</text>`;
	return svgMarkup(
		144,
		144,
		figure(counts.approval + counts.question, 66, STATE_COLOR.approval) + `<rect x="40" y="76" width="64" height="4" rx="2" fill="${COLORS.muted}" fill-opacity=".5"/>` + figure(counts.running, 128, STATE_COLOR.running),
	);
}

/** The selected thread's access mode; Full access in amber, as T3 Code warns about it. */
export const modeFace = (mode: RuntimeMode | undefined): string =>
	mode === undefined ? ringFace(COLORS.muted, "modeSupervised", { dim: true }) : ringFace(mode === "full-access" ? STATE_COLOR.approval : COLORS.accent, MODE_GLYPH[mode]);

/** The selected thread's effort: its glyph over one dot per level, filled up to the current one. */
export function effortFace(level: { index: number; count: number } | undefined): string {
	if (level === undefined) return ringFace(COLORS.muted, "effort", { dim: true });
	const mark = glyph("effort", 46, 22, 52, COLORS.accent, 3);
	const gap = 18;
	const left = 72 - ((level.count - 1) * gap) / 2;
	const dots = Array.from({ length: level.count }, (_, index) => `<circle cx="${left + index * gap}" cy="104" r="6" fill="${COLORS.accent}"${index <= level.index ? "" : ` fill-opacity=".3"`}/>`).join("");
	return svgMarkup(144, 144, mark + dots);
}

/** A prompt the user wrote in the action's editor, drawn as Stream Deck's Send arrow. */
export const customPromptFace = (available: boolean): string => ringFace(COLORS.accent, "send", { dim: !available });
