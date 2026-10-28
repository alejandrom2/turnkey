import { type MessageKey, t } from "../i18n.js";
import type { ShellRow } from "./shell.js";

export type Decision = "accept" | "acceptForSession" | "acceptAlways" | "decline" | "cancel";
export type Question = {
	id: string;
	header: string;
	question: string;
	options: { label: string; description?: string; value?: string }[];
	multiSelect?: boolean;
	required?: boolean;
};
export type PendingRequest =
	| { type: "approval"; threadId: string; requestId: string; heading: string; summary: string; decisions: Decision[] }
	| { type: "question"; threadId: string; requestId: string; questions: Question[]; messageMode: boolean }
	| { type: "unsupported"; threadId: string; requestId: string; heading: string };

/** The turn item behind a pending request, the parts the deck reads. */
export type TurnItem = {
	type: string;
	requestId?: string;
	prompt?: string;
	reason?: string;
	options?: { decision: Decision }[];
	questions?: Question[];
	responseMode?: "message";
};

/** A request's turn item, and whether the provider can still take an answer. */
type FoundItem = { item: TurnItem | null | undefined; live: boolean };

const APPROVAL_HEADING: Record<string, MessageKey> = {
	command: "approval.command",
	"file-read": "approval.fileRead",
	"file-change": "approval.fileChange",
	permission: "approval.permission",
	"mcp-elicitation": "approval.mcpElicitation",
};
/** Approvals the deck answers; others (tool calls, app access, auth) open in T3 Code. */
const ANSWERABLE = new Set(["command", "file-read", "file-change", "permission", "user_input"]);
const DECK_DECISIONS: Decision[] = ["accept", "acceptForSession", "acceptAlways", "decline"];
/** Assumed when a request lists no options; "always" is offered only when the adapter lists it. */
const DEFAULT_DECISIONS: Decision[] = ["accept", "acceptForSession", "decline"];

/** Whether the deck can answer this kind of request, so its turn item is worth reading. */
export function isAnswerable(kind: string): boolean {
	return ANSWERABLE.has(kind);
}

/** The request's turn item from a bounded thread snapshot; `live` is false when the provider can't take an answer. */
export function requestInSnapshot(snapshot: unknown, requestId: string): FoundItem | undefined {
	const projection = snapshot as { turnItems?: TurnItem[]; runtimeRequests?: { id: string; responseCapability?: { type?: string } }[] } | undefined;
	if (projection === undefined) return undefined;
	const item = projection.turnItems?.findLast((candidate) => candidate.requestId === requestId);
	const capability = projection.runtimeRequests?.find((request) => request.id === requestId)?.responseCapability?.type;
	return { item, live: capability !== "not_resumable" };
}

/** What the deck shows for a pending request, given its turn item when one was found. */
export function readPendingRequest(pending: NonNullable<ShellRow["pendingRequest"]>, found: FoundItem | undefined): PendingRequest {
	const base = { threadId: pending.threadId, requestId: pending.id };
	const heading = t(APPROVAL_HEADING[pending.kind] ?? "approval.needsYou");
	if (!ANSWERABLE.has(pending.kind) || found?.item == null || !found.live) return { type: "unsupported", ...base, heading };
	if (found.item.type === "user_input_request") {
		return { type: "question", ...base, questions: found.item.questions ?? [], messageMode: found.item.responseMode === "message" };
	}
	if (found.item.type !== "approval_request") return { type: "unsupported", ...base, heading };
	const offered = found.item.options?.map((option) => option.decision);
	const decisions = offered === undefined ? DEFAULT_DECISIONS : DECK_DECISIONS.filter((decision) => offered.includes(decision));
	return {
		type: "approval",
		...base,
		heading,
		summary: found.item.prompt?.trim() || found.item.reason?.trim() || heading,
		decisions: decisions.length > 0 ? decisions : DEFAULT_DECISIONS,
	};
}
