import { t } from "../i18n.js";
import { type GlyphName, renderNoticeKey } from "../render.js";
import { grants } from "../scopes.js";
import type { Machine } from "../t3/machine.js";
import type { OptInScope } from "../t3/pairing.js";
import type { KeyRuntime } from "./key.js";

/**
 * Flags what `machine` lacks of `scopes` for its next pairing, where the host asks for access (Stream Deck, once the
 * user presses a key that needs it); true when it holds them all.
 */
export function ensureScopes(runtime: Pick<KeyRuntime, "optIn" | "warn">, machine: Machine, scopes: readonly OptInScope[]): boolean {
	const lacking = scopes.filter((scope) => !grants(machine.scopes, scope));
	if (lacking.length > 0) void runtime.optIn?.request(machine.url, ...lacking).catch((error: unknown) => runtime.warn(`Flagging access failed: ${error instanceof Error ? error.message : String(error)}`));
	return lacking.length === 0;
}

/** The machine lacks `scopes` and its next pairing asks for them: the key says to pair again. */
export const awaitingPairing = (runtime: Pick<KeyRuntime, "optIn">, machine: Machine, scopes: readonly OptInScope[]): boolean =>
	scopes.some((scope) => !grants(machine.scopes, scope) && (runtime.optIn?.requested(machine.url, scope) ?? false));

export const accessFace = (glyph: GlyphName, title: string) => renderNoticeKey({ glyph, title, detail: t("access.rePair"), tone: "attention" });
