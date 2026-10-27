import { t } from "./i18n.js";
import {
	ACCESS_SCOPE,
	DIAGNOSTICS_SCOPE,
	isOptInScope,
	MAINTAIN_SCOPE,
	OPERATE_SCOPE,
	OPT_IN_SCOPES,
	type OptInScope,
	PROVIDERS_SCOPE,
	SOURCE_CONTROL_SCOPE,
	TERMINAL_READ_SCOPE,
	TERMINAL_SCOPE,
} from "./t3/pairing.js";

/**
 * Per machine (its URL), the broader scopes the user turned on an action for. The machine's next pairing asks for
 * them too; until then actions that need them say so. Kept by the plugin in global settings, like the tokens.
 */
export type ScopeRequests = Record<string, OptInScope[]>;

/** Reads the saved requests, keeping only scopes the deck knows to ask for. */
export function readScopeRequests(raw: unknown): ScopeRequests {
	const requests: ScopeRequests = {};
	if (raw === null || typeof raw !== "object") return requests;
	for (const [url, scopes] of Object.entries(raw)) {
		const known = Array.isArray(scopes) ? [...new Set(scopes.filter((scope): scope is OptInScope => typeof scope === "string" && isOptInScope(scope)))] : [];
		if (known.length > 0) requests[url] = known;
	}
	return requests;
}

/** Flags `scope` for the machine's next pairing; the same object when it already was. */
export function requestScope(requests: ScopeRequests, url: string, scope: OptInScope): ScopeRequests {
	const current = requests[url] ?? [];
	return current.includes(scope) ? requests : { ...requests, [url]: [...current, scope] };
}

/** Un-flags `scope`, so the machine's next pairing no longer asks for it; the same object when it wasn't flagged. */
export function dropScopeRequest(requests: ScopeRequests, url: string, scope: string): ScopeRequests {
	const current = requests[url] ?? [];
	if (!current.includes(scope as OptInScope)) return requests;
	const left = current.filter((candidate) => candidate !== scope);
	const { [url]: _dropped, ...rest } = requests;
	return left.length > 0 ? { ...rest, [url]: left } : rest;
}

/** Per opt-in scope a machine has or will ask for: held by its pairing, or pending its next one. */
export type OptInStatus = { scope: OptInScope; state: "held" | "pending" };

export function optInStatus(granted: readonly string[], requested: readonly string[]): OptInStatus[] {
	return OPT_IN_SCOPES.flatMap((scope): OptInStatus[] => (granted.includes(scope) ? [{ scope, state: "held" }] : requested.includes(scope) ? [{ scope, state: "pending" }] : []));
}

/** Drops the requests a pairing granted; the rest stay flagged for the pairing after. */
export function settleScopeRequests(requests: ScopeRequests, url: string, granted: readonly string[]): ScopeRequests {
	const left = (requests[url] ?? []).filter((scope) => !granted.includes(scope));
	const { [url]: _settled, ...rest } = requests;
	return left.length > 0 ? { ...rest, [url]: left } : rest;
}

/** Whether a session holds `scope`. T3 Code checks session scopes as granted, without implying one from another. */
export const grants = (scopes: readonly string[], scope: string): boolean => scopes.includes(scope);

/** What a key says when its machine's pairing lacks `scope`: a new pair link from T3 Code grants it. */
export function needsAccessLabel(scope: string): string {
	switch (scope) {
		case SOURCE_CONTROL_SCOPE:
			return t("access.sourceControl");
		case DIAGNOSTICS_SCOPE:
			return t("access.diagnostics");
		case PROVIDERS_SCOPE:
			return t("access.providers");
		case MAINTAIN_SCOPE:
			return t("access.maintain");
		case TERMINAL_SCOPE:
		case TERMINAL_READ_SCOPE:
			return t("access.terminal");
		case ACCESS_SCOPE:
			return t("access.share");
		case OPERATE_SCOPE:
			return t("failure.readOnly");
		default:
			return t("access.other");
	}
}
