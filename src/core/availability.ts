import type { DeckThread } from "./board.js";

export type ActionKind =
	| "open"
	| "select"
	| "stop"
	| "send"
	| "steer"
	| "new"
	| "launch"
	| "organize"
	| "pin"
	| "unpin"
	| "model"
	| "effort"
	| "speed"
	| "permissions"
	| "plan"
	| "answer"
	| "approve"
	| "deny"
	| "pr"
	| "branch";

export type AvailabilityInput = {
	/** The thread the action targets: usually the selected one. */
	thread?: Pick<DeckThread, "deck" | "active" | "pinned" | "pendingRequest"> & Partial<Pick<DeckThread, "pullRequests" | "branch">>;
	/** The target's machine (or, for New Thread, the machine it launches on) may act, not just read. */
	canOperate: boolean;
	/** A saved prompt is set, for actions that send one. */
	hasPrompt?: boolean;
	/** Why the thread's model or provider (or New Thread's destination) can't take this, when it can't: "No fast mode". */
	missing?: string;
};

export type Availability = { available: true } | { available: false; reason: string };

const yes: Availability = { available: true };
const no = (reason: string): Availability => ({ available: false, reason });

/** Whether an action can act right now, and the short reason drawn on its key when it can't. */
export function availability(kind: ActionKind, input: AvailabilityInput): Availability {
	const { thread } = input;
	if ((kind === "send" || kind === "steer" || kind === "new") && !input.hasPrompt) return no("No prompt");
	if (kind === "new" || kind === "launch") return input.missing ? no(input.missing) : input.canOperate ? yes : no("Read only");
	if (thread === undefined) return no(kind === "answer" || kind === "approve" || kind === "deny" ? "Nothing pending" : "No thread");
	if (kind === "open" || kind === "select") return yes;
	// Opening a link or the thread only reads, so a read-only pairing may.
	if (kind === "pr") return (thread.pullRequests?.length ?? 0) > 0 ? yes : no("No PR");
	if (kind === "branch") return thread.branch ? yes : no("No branch");
	switch (kind) {
		case "stop":
		case "steer":
			if (!thread.active) return no("Not running");
			break;
		case "pin":
			if (thread.pinned) return no("Pinned");
			break;
		case "unpin":
			if (!thread.pinned) return no("Not pinned");
			break;
		case "answer":
			if (thread.pendingRequest === undefined || (thread.deck !== "approval" && thread.deck !== "question")) return no("Nothing pending");
			break;
		case "approve":
		case "deny":
			if (thread.pendingRequest === undefined || thread.deck !== "approval") return no("Nothing pending");
			break;
	}
	if (input.missing) return no(input.missing);
	return input.canOperate ? yes : no("Read only");
}
