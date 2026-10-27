/** How long a key or strip shows the result of a press before its live face returns. */
export const FLASH_MS = 1_200;

/** A failure in a dozen characters or so, or T3 Code's own reason for refusing, for a key face; the full message goes to the log. */
export function failureLabel(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const reason = (error as { reason?: unknown } | null)?.reason;
	if (/read-only/i.test(message)) return "Read only";
	if (/not connected/i.test(message)) return "Offline";
	if (/update it/i.test(message)) return "Update T3 Code";
	if (/default model/i.test(message)) return "No model";
	if (/no machine/i.test(message)) return "No machine";
	if (/timed out|timeout/i.test(message)) return "Timed out";
	if (typeof reason === "string" && reason) return reason.replace(/\.$/, "");
	return "Failed";
}
