import { t } from "../i18n.js";
import { type GlyphName, renderNoticeKey } from "../render.js";
import { grants, needsAccessLabel } from "../scopes.js";
import type { Machine } from "../t3/machine.js";
import type { OptInScope } from "../t3/pairing.js";
import type { KeyRuntime, PressPlan } from "./key.js";

/**
 * What a press does while `machine` lacks some of `scopes`; undefined when it holds them all. Stream Deck flags the
 * access for the machine's next pairing first, then flashes that it's needed, in that order as it always did;
 * Logitech never asks for it, so it only flashes.
 */
export function accessPlan(runtime: Pick<KeyRuntime, "optIn">, machine: Machine, scopes: readonly OptInScope[]): PressPlan | undefined {
	const lacking = scopes.filter((scope) => !grants(machine.scopes, scope));
	if (lacking.length === 0) return undefined;
	const optIn = runtime.optIn;
	if (optIn === undefined) return { kind: "fail", label: needsAccessLabel(lacking[0]!) };
	return {
		kind: "run",
		work: async () => {
			await optIn.request(machine.url, ...lacking);
			// The press flashes the scope it lacks, as failureLabel reads it.
			throw Object.assign(new Error("Missing opt-in access"), { requiredPermission: lacking[0]! });
		},
	};
}

/** Why a host that can't ask for access (Logitech) can't act: the first of `scopes` the machine lacks; undefined where it holds them or the host can ask. */
export function unreachable(runtime: Pick<KeyRuntime, "optIn">, machine: Machine, scopes: readonly OptInScope[]): string | undefined {
	if (runtime.optIn !== undefined) return undefined;
	const lacking = scopes.find((scope) => !grants(machine.scopes, scope));
	return lacking === undefined ? undefined : needsAccessLabel(lacking);
}

/** The machine lacks `scopes` and its next pairing asks for them: the key says to pair again. */
export const awaitingPairing = (runtime: Pick<KeyRuntime, "optIn">, machine: Machine, scopes: readonly OptInScope[]): boolean =>
	scopes.some((scope) => !grants(machine.scopes, scope) && (runtime.optIn?.requested(machine.url, scope) ?? false));

export const accessFace = (glyph: GlyphName, title: string) => renderNoticeKey({ glyph, title, detail: t("access.rePair"), tone: "attention" });
