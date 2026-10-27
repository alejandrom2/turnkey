import { t } from "./i18n.js";
import { needsAccessLabel } from "./scopes.js";

/** How long a key or strip shows the result of a press before its live face returns. */
export const FLASH_MS = 1_200;

/** A failure in a dozen characters or so, or T3 Code's own reason for refusing, for a key face; the full message goes to the log. */
export function failureLabel(error: unknown): string {
	// Matches the deck's own English errors (machine.ts, rpc.ts), which stay untranslated so these patterns hold.
	const message = error instanceof Error ? error.message : String(error);
	const { reason, requiredPermission } = (error ?? {}) as { reason?: unknown; requiredPermission?: unknown };
	// T3 Code names the missing scope in `requiredPermission`; `requiredScope` is its legacy parent.
	if (typeof requiredPermission === "string") return needsAccessLabel(requiredPermission);
	if (/read-only/i.test(message)) return t("failure.readOnly");
	if (/not connected/i.test(message)) return t("failure.offline");
	if (/update it/i.test(message)) return t("failure.updateT3");
	if (/default model/i.test(message)) return t("failure.noModel");
	if (/no machine/i.test(message)) return t("failure.noMachine");
	if (/timed out|timeout/i.test(message)) return t("failure.timedOut");
	if (typeof reason === "string" && reason) return reason.replace(/\.$/, "");
	return t("failure.failed");
}
