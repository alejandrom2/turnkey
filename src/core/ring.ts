import type { DeckThread } from "./board.js";
import { t } from "./i18n.js";
import { type CatalogModel, modelColor, providerDisplayName, providerMark } from "./models.js";
import { COLORS, glyph, type GlyphName, MODE_GLYPH, STATE_COLOR, svgMarkup } from "./render.js";
import type { RuntimeMode } from "./t3/shell.js";

/**
 * The ring draws its own disc behind each slot, white and black on hover, so a face is just one glyph in the action's
 * color, drawn heavy enough for both, plus a count when one matters.
 */
export function ringFace(color: string, name: GlyphName, options: { badge?: number | string; dim?: boolean } = {}): string {
	const mark = glyph(name, 28, 28, 88, options.dim ? COLORS.muted : color, 3.2);
	const badge =
		options.badge === undefined
			? ""
			: `<circle cx="118" cy="26" r="24" fill="${COLORS.key}"/><text x="118" y="35" font-size="28" font-weight="700" text-anchor="middle" fill="${COLORS.text}">${options.badge}</text>`;
	return svgMarkup(144, 144, (options.dim ? `<g opacity=".6">${mark}</g>` : mark) + badge);
}

/** The selected thread's access mode; Full access in amber, as T3 Code warns about it. */
export const modeFace = (mode: RuntimeMode | undefined): string =>
	mode === undefined ? ringFace(COLORS.muted, "modeSupervised", { dim: true }) : ringFace(mode === "full-access" ? STATE_COLOR.approval : COLORS.accent, MODE_GLYPH[mode]);

/** The selected thread's effort: its glyph over one dot per level, filled up to the current one, in the level's color. */
export function effortFace(level: { index: number; count: number; color: string } | undefined): string {
	if (level === undefined) return ringFace(COLORS.muted, "effort", { dim: true });
	const mark = glyph("effort", 34, 8, 76, level.color, 3.2);
	const gap = 24;
	const left = 72 - ((level.count - 1) * gap) / 2;
	const dots = Array.from({ length: level.count }, (_, index) => `<circle cx="${left + index * gap}" cy="114" r="8.5" fill="${level.color}"${index <= level.index ? "" : ` fill-opacity=".3"`}/>`).join("");
	return svgMarkup(144, 144, mark + dots);
}

/**
 * A model from T3 Code's picker: its provider's mark, large, in its color. The thread's own wears a black check badge,
 * whose white check still shows on the disc Logi turns black on hover. The name is the slot's label: Options+ draws
 * faces at 80 px, too small for a name to read.
 */
export function modelFace(model: CatalogModel | undefined, current: boolean): string {
	if (model === undefined) return ringFace(COLORS.muted, "model", { dim: true });
	const color = modelColor(model) ?? COLORS.accent;
	return svgMarkup(144, 144, providerMark(model, 26, 26, 92, { color }) + (current ? `<circle cx="111" cy="111" r="21" fill="${COLORS.key}"/><path d="M101 112l7 7 12.5-14" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round" stroke-linejoin="round"/>` : ""));
}

/** The board lists running threads newest first, so this is the run that started last. */
export const stopTarget = <T extends Pick<DeckThread, "deck" | "key">>(threads: readonly T[], selected: T | undefined): T | undefined =>
	(selected?.deck === "running" ? threads.find((thread) => thread.key === selected.key) : undefined) ?? threads.find((thread) => thread.deck === "running");

export const stopFace = (available: boolean): string => ringFace(COLORS.accent, "stop", { dim: !available });

/** The prompts a ring slot can send, each as its own glyph; Continue is its own action. */
export const PROMPT_GLYPHS = { test: "scriptTest", fix: "hammer", explain: "book", commit: "gitCommit" } as const satisfies Record<string, GlyphName>;

/** Always in full color, so a placed prompt always says which one it is; a press with no thread open just does nothing. */
export const promptFace = (name: keyof typeof PROMPT_GLYPHS): string => ringFace(COLORS.accent, PROMPT_GLYPHS[name]);

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

/** A prompt the user wrote in the action's editor, drawn as Stream Deck's Send arrow; dimmed only while it has no text. */
export const customPromptFace = (hasText: boolean): string => ringFace(COLORS.accent, "send", { dim: !hasText });
