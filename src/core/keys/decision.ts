import { approvalAuthority, approvalConfirm, approvePress, authorityLabel, confirmed as approvalConfirmed } from "../approvals.js";
import { type Availability, availability } from "../availability.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import { renderDecisionKey, renderSkeletonKey } from "../render.js";
import type { ApprovalPress } from "../approvals.js";
import type { PendingRequest } from "../t3/machine.js";
import { type KeyContext, type KeyDefinition, type PressPlan, confirmed } from "./key.js";
import { requestFor } from "./requests.js";

/** What a request is about, in a line: the approval's summary, or the heading of one the deck can't answer. */
const requestSummary = (request: PendingRequest): string =>
	request.type === "approval" ? request.summary : request.type === "unsupported" ? request.heading : t("face.needsYou");

export type ApproveSettings = { approvalAuthority?: string; approvalConfirm?: string; machine?: string };

type Decided = { thread: DeckThread | undefined; pinned: boolean; check: Availability; request: PendingRequest | undefined };
export type ApproveState = Decided & { press: ApprovalPress | undefined; confirm: ReturnType<typeof approvalConfirm>; authority: ReturnType<typeof approvalAuthority> };
export type DenyState = Decided;

// With no thread, any machine may act: the key's own machine setting is not consulted (as on Stream Deck always).
const canOperate = (ctx: KeyContext<unknown>, thread: DeckThread | undefined): boolean =>
	thread !== undefined ? thread.machine.canOperate : ctx.runtime.machines().some((machine) => machine.canOperate);

/** Open the request in T3 Code, or answer it; `answer` is the decision to send, whether it needs confirming first, and the face saying so. */
function plan(state: Decided, ctx: KeyContext<unknown>, answer: { decision: Parameters<DeckThread["machine"]["respond"]>[2]; allowed: boolean; hold: string } | undefined): PressPlan {
	const { thread, check, request } = state;
	if (!check.available) return { kind: "fail", label: check.reason };
	if (request === undefined) return { kind: "fail", label: t("result.loading") };
	if (answer === undefined || request.type !== "approval") return { kind: "run", work: () => ctx.runtime.openThread(thread!) };
	if (!answer.allowed) return { kind: "needsHold", label: answer.hold };
	return { kind: "run", work: () => thread!.machine.respond(request.threadId, request.requestId, answer.decision) };
}

export const approveKey: KeyDefinition<ApproveSettings, ApproveState> = {
	available: ({ check }) => check.available,

	state(ctx) {
		const authority = approvalAuthority(ctx.settings.approvalAuthority);
		const { thread, gone, pinned } = ctx.target();
		const check = availability("approve", { thread, gone, canOperate: authority === "open" || canOperate(ctx, thread) });
		const request = check.available && thread !== undefined ? requestFor(ctx.runtime, thread) : undefined;
		const press = request?.type === "approval" ? approvePress(authority, request.decisions) : undefined;
		return { thread, pinned, check, request, press, confirm: approvalConfirm(ctx.settings.approvalConfirm), authority };
	},

	tile({ check, request, press, authority, confirm, pinned }) {
		if (!check.available) return renderDecisionKey({ kind: "approve", armed: false, caption: authorityLabel(authority), detail: check.reason, pinned });
		if (request === undefined) return renderSkeletonKey();
		const label = press?.label ?? authorityLabel("open");
		const caption = press?.kind === "respond" && confirm === "hold" ? t("strip.withHold", { label }) : label;
		return renderDecisionKey({ kind: "approve", armed: true, caption, detail: requestSummary(request), pinned });
	},

	press(state, ctx, input) {
		const { press, confirm } = state;
		if (press === undefined || press.kind === "open") return plan(state, ctx, undefined);
		return plan(state, ctx, { decision: press.decision, allowed: confirmed(input, () => approvalConfirmed(press, confirm, input.heldMs)), hold: t("result.holdToAllow") });
	},
};

export const denyKey: KeyDefinition<Record<string, unknown>, DenyState> = {
	available: ({ check }) => check.available,

	state(ctx) {
		const { thread, gone, pinned } = ctx.target();
		const check = availability("deny", { thread, gone, canOperate: canOperate(ctx, thread) });
		return { thread, pinned, check, request: check.available && thread !== undefined ? requestFor(ctx.runtime, thread) : undefined };
	},

	tile({ check, request, pinned }) {
		if (check.available && request === undefined) return renderSkeletonKey();
		return renderDecisionKey({ kind: "deny", armed: check.available, caption: t("face.deny"), detail: request ? requestSummary(request) : check.available ? undefined : check.reason, pinned });
	},

	// Declining is a tap today; Logi's hold on the keypad comes from `confirmBy`.
	press: (state, ctx, input) => plan(state, ctx, { decision: "decline", allowed: confirmed(input, () => true), hold: t("result.holdToDeny") }),
};
