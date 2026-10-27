import { type MessageKey, t } from "./i18n.js";
import type { Decision } from "./t3/machine.js";

/** How far an approve press may go: open the request in T3 Code, or answer it once, for the session, or always. */
export type ApprovalAuthority = "open" | "once" | "session" | "always";
/** Whether answering needs a hold (default) or a tap. */
export type ApprovalConfirm = "hold" | "tap";

/** A hold that answers an approval; longer than a long press so a slow tap never approves. */
export const HOLD_CONFIRM_MS = 600;

const AUTHORITY_DECISION: Record<Exclude<ApprovalAuthority, "open">, Decision> = {
	once: "accept",
	session: "acceptForSession",
	always: "acceptAlways",
};

const LABEL: Record<ApprovalAuthority, MessageKey> = { open: "approval.open", once: "approval.once", session: "approval.session", always: "approval.always" };

export const approvalAuthority = (value: unknown): ApprovalAuthority =>
	value === "once" || value === "session" || value === "always" ? value : "open";

export const approvalConfirm = (value: unknown): ApprovalConfirm => (value === "tap" ? "tap" : "hold");

export type ApprovalPress = { kind: "open"; label: string } | { kind: "respond"; decision: Decision; label: string };

/**
 * What an approve press does under `authority`, given the decisions the request offers. An authority the request
 * doesn't offer (an adapter without "for session", say) falls back to opening it in T3 Code.
 */
export function approvePress(authority: ApprovalAuthority, offered: readonly Decision[]): ApprovalPress {
	if (authority === "open") return { kind: "open", label: t(LABEL.open) };
	const decision = AUTHORITY_DECISION[authority];
	return offered.includes(decision) ? { kind: "respond", decision, label: t(LABEL[authority]) } : { kind: "open", label: t(LABEL.open) };
}

/** Deny needs no authority: every pairing that may act may decline. */
export const DENY_PRESS: ApprovalPress = {
	kind: "respond",
	decision: "decline",
	get label() {
		return t("approval.deny");
	},
};

/** The face label for a key or dial carrying `authority`, before any request is loaded. */
export const authorityLabel = (authority: ApprovalAuthority): string => t(LABEL[authority]);

/** A press answers only after the confirmation `confirm` asks for; opening never needs one. */
export const confirmed = (press: ApprovalPress, confirm: ApprovalConfirm, heldMs: number): boolean =>
	press.kind === "open" || confirm === "tap" || heldMs >= HOLD_CONFIRM_MS;
