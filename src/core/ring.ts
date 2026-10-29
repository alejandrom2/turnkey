import { type CatalogModel, modelColor, providerMark } from "./models.js";
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
