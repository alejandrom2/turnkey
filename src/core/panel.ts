/**
 * Pure helpers shared by the action panels and the Turnkey Settings window. `scripts/ui.ts` inlines their source into
 * the pages, so each stays self-contained: no imports, no outside constants.
 */

type MachineState = { state: string };

type SummaryTone = "ok" | "wait" | "muted";

/** The panel's one-line machine summary: how many are connected, amber when one needs pairing or failed. */
export function machineSummary(environments: readonly MachineState[]): { tone: SummaryTone; key: string; params: Record<string, number> } {
	if (environments.length === 0) return { tone: "muted", key: "inspector.card.noMachines", params: {} };
	const ready = environments.filter((env) => env.state === "ready").length;
	const trouble = environments.some((env) => env.state === "signed-out" || env.state === "error");
	return {
		tone: trouble ? "wait" : ready === environments.length ? "ok" : "muted",
		key: "inspector.card.connectedCount",
		params: { ready, total: environments.length },
	};
}

/** Nothing paired yet, so the panel offers the pair link field itself; machines still connecting don't count. */
export function needsFirstPairing(environments: readonly MachineState[]): boolean {
	return environments.every((env) => env.state === "signed-out");
}

/**
 * The settings window's write: the latest global settings with only the keys it edits replaced. Stream Deck replaces
 * global settings whole, and `environments`, `auth`, `scopeRequests` and `verboseUntil` belong to the plugin.
 */
export function mergeGlobalSettings(current: Record<string, unknown> | null | undefined, patch: Record<string, unknown>): Record<string, unknown> {
	const editable = ["scheme", "stripBackground", "stripColor", "stripStyle", "textScroll", "motion", "idlePet", "confirmSend", "maxEffort"];
	const next: Record<string, unknown> = { ...current };
	for (const key of editable) if (key in patch) next[key] = patch[key];
	return next;
}
