import { FLASH_MS, failureLabel } from "../core/feedback.js";
import type { KeyContext, KeyDefinition, KeyRuntime } from "../core/keys/key.js";
import { COLORS, GLYPHS, type GlyphName, renderResultKey } from "../core/render.js";
import type { KeyKind } from "./keys.js";
import { glyphResult, ringFace } from "./ring.js";

const DATA_URL = "data:image/svg+xml;base64,";

/** Stream Deck's renderers return data URLs; Logi takes the markup. */
const markup = (image: string): string => (image.startsWith(DATA_URL) ? Buffer.from(image.slice(DATA_URL.length), "base64").toString("utf8") : image);

/** A ring glyph from the tile's first icon; a dim placeholder while the tile has none (a loading skeleton). */
export function glyphFallback(tile: string, dim: boolean): string {
	let found: { name: GlyphName; at: number } | undefined;
	for (const name of Object.keys(GLYPHS) as GlyphName[]) {
		const at = tile.indexOf(`>${GLYPHS[name]}</g>`);
		if (at >= 0 && (found === undefined || at < found.at)) found = { name, at };
	}
	return found === undefined ? ringFace(COLORS.muted, "chat", { dim: true }) : ringFace(COLORS.accent, found.name, { dim });
}

/**
 * A Logi kind over a shared definition: each parameter is a variant standing for its settings, on the thread open in
 * T3 Code. The Ring (80 px or less) gets the glyph, a keypad the tile. A press with no hold time is a Ring click, itself
 * the confirmation; one with a hold time is a keypad press, which irreversible keys want held.
 */
export function sharedKind<S, St>(name: string, definition: KeyDefinition<S, St>, variants: Record<string, S>, runtime: KeyRuntime, warn: (message: string) => void): KeyKind {
	const flashes = new Map<string, { label: string; timer: ReturnType<typeof setTimeout> }>();
	let warned = false;

	function contextOf(parameter: string): KeyContext<S> | undefined {
		if (!Object.hasOwn(variants, parameter)) {
			// The parameter only reaches the log by kind: Logi could hand any text.
			if (!warned) warn(`${name}: dropped an action variant Turnkey doesn't know.`);
			warned = true;
			return undefined;
		}
		return { settings: variants[parameter]!, machine: undefined, runtime, target: () => ({ thread: runtime.board.selectedOn(), pinned: false }) };
	}

	function clearFlash(parameter: string): void {
		clearTimeout(flashes.get(parameter)?.timer);
		flashes.delete(parameter);
	}

	/** Shows why a press didn't act, on the face and in the label (all the Ring can read), then the live face again. */
	function flash(parameter: string, label: string): void {
		clearFlash(parameter);
		const timer = setTimeout(() => {
			flashes.delete(parameter);
			runtime.repaint();
		}, FLASH_MS);
		flashes.set(parameter, { label, timer });
		runtime.repaint();
	}

	return {
		face(_index, parameter, size) {
			const ctx = contextOf(parameter);
			if (ctx === undefined) return undefined;
			const flashing = flashes.get(parameter);
			if (flashing !== undefined) return size <= 80 ? glyphResult(false, flashing.label) : markup(renderResultKey({ ok: false, label: flashing.label }));
			const state = definition.state(ctx);
			if (size > 80) return markup(definition.tile(state, ctx));
			return definition.glyph ? markup(definition.glyph(state, ctx)) : glyphFallback(markup(definition.tile(state, ctx)), definition.available?.(state) === false);
		},
		label(_index, parameter) {
			const flashing = flashes.get(parameter);
			if (flashing !== undefined) return flashing.label;
			const ctx = contextOf(parameter);
			return ctx && definition.label?.(definition.state(ctx), ctx);
		},
		press(_index, parameter, heldMs) {
			const ctx = contextOf(parameter);
			if (ctx === undefined) return;
			const plan = definition.press(definition.state(ctx), ctx, { heldMs: heldMs ?? 0, confirmBy: heldMs === undefined ? "click" : "hold" });
			if (plan.kind === "run")
				void plan.work().then(
					() => {
						clearFlash(parameter);
						runtime.repaint();
					},
					(error: unknown) => {
						// The message only: errors never carry tokens, but their causes might.
						warn(`${name}: a press failed: ${error instanceof Error ? error.message : String(error)}`);
						flash(parameter, failureLabel(error));
					},
				);
			else if (plan.kind !== "nothing") flash(parameter, plan.label);
		},
	};
}
