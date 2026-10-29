import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import type { PendingRequest } from "../t3/machine.js";
import type { KeyRuntime } from "./key.js";

/** Approval details per thread and request, loaded once and shared by every Approve and Deny key, whoever draws it. */
const requests = new Map<string, PendingRequest | "loading">();

/** The thread's pending request, or undefined while it loads (the runtime repaints when it lands). */
export function requestFor(runtime: Pick<KeyRuntime, "board" | "repaint">, thread: DeckThread): PendingRequest | undefined {
	const pending = thread.pendingRequest;
	if (pending === undefined) return undefined;
	const id = `${thread.key}#${pending.id}`;
	const cached = requests.get(id);
	if (cached !== undefined) return cached === "loading" ? undefined : cached;
	const live = new Set(runtime.board.threads.flatMap((other) => (other.pendingRequest ? [`${other.key}#${other.pendingRequest.id}`] : [])));
	for (const key of requests.keys()) if (!live.has(key)) requests.delete(key);
	requests.set(id, "loading");
	thread.machine
		.pendingRequest(thread)
		.catch((): PendingRequest => ({ type: "unsupported", threadId: pending.threadId, requestId: pending.id, heading: t("approval.needsYou") }))
		.then((request) => {
			if (request === undefined) requests.delete(id);
			else requests.set(id, request);
			runtime.repaint();
		});
	return undefined;
}
