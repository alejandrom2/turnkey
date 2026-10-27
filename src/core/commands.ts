import { execFile } from "node:child_process";

import type { DeckThread } from "./board.js";
import { answerValue, type ModelOption, type ModelSelection, type OptionValue, type ProviderCapability, type Question, type ThreadConfiguration } from "./t3.js";

export type OrganizeAction = "settle" | "pin" | "unpin" | "snooze" | "archive" | "mark_unread";
export type SendMode = "auto" | "queue" | "steer" | "restart";

/** `t3code://threads/<environmentId>/<threadId>`, handled by T3 Code desktop (`packages/shared/src/promptLinks.ts`). */
export function threadDeepLink(thread: Pick<DeckThread, "environmentId" | "threadId">, scheme = "t3code"): string {
	return `${scheme}://threads/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.threadId)}`;
}

/** Stream Deck's `openUrl` refuses custom schemes, so hand the link to the OS. */
export function openExternal(url: string): Promise<void> {
	const [command, args] =
		process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["open", [url]];
	return new Promise((resolve, reject) => execFile(command, args, (error) => (error ? reject(error) : resolve())));
}

export const stop = (thread: DeckThread) =>
	thread.source.call("t3_thread_interrupt", { threadId: thread.threadId, reason: "Stopped from Stream Deck" });

export const send = (thread: DeckThread, message: string, mode: SendMode = "auto") =>
	thread.source.call("t3_thread_send", { threadId: thread.threadId, message, mode });

/** Starts a top-level thread in the same project as `near`, inheriting nothing from the deck. */
export const launch = (near: DeckThread, message: string, title: string) =>
	near.source.call<{ threadId: string }>("t3_thread_launch", { projectId: near.projectId, title, message });

export function organize(thread: DeckThread, action: OrganizeAction, snoozeMinutes = 60) {
	const snoozedUntil = action === "snooze" ? new Date(Date.now() + snoozeMinutes * 60_000).toISOString() : undefined;
	return thread.source.call("t3_thread_organize", { threadId: thread.threadId, action, snoozedUntil });
}

export type PendingQuestion = { requestId: string; questions: Question[] };

export async function firstQuestion(thread: DeckThread): Promise<PendingQuestion | undefined> {
	const { requestIds } = await thread.source.call<{ requestIds: string[] }>("t3_pending_request", { action: "list", threadId: thread.threadId });
	const requestId = requestIds[0];
	if (requestId === undefined) return undefined;
	return thread.source.call<PendingQuestion>("t3_pending_request", { action: "read", threadId: thread.threadId, requestId });
}

/** `picks[i]` is the chosen option index for `questions[i]`. */
export function answer(thread: DeckThread, pending: PendingQuestion, picks: number[]) {
	const answers = Object.fromEntries(
		pending.questions.map((question, index) => {
			const option = question.options[picks[index] ?? 0];
			const value = option === undefined ? "" : answerValue(option);
			return [question.id, question.multiSelect ? [value] : value];
		}),
	);
	return thread.source.call("t3_pending_request", { action: "respond", threadId: thread.threadId, requestId: pending.requestId, answers });
}

export type ModelKnob = {
	selection: ModelSelection;
	options: ModelOption[];
};

/** The focused thread's model selection with every option its provider exposes for that model. */
export async function modelKnob(thread: DeckThread): Promise<ModelKnob> {
	const [{ modelSelection }, { providers }] = await Promise.all([
		thread.source.call<ThreadConfiguration>("t3_thread_configure", { threadId: thread.threadId }),
		thread.source.call<{ providers: ProviderCapability[] }>("orchestrator_capabilities", { search: thread.model }),
	]);
	const provider = providers.find((candidate) => candidate.providerInstanceId === modelSelection.instanceId);
	const model = provider?.models.find((candidate) => candidate.id === modelSelection.model);
	return { selection: modelSelection, options: model?.options?.filter((option) => option.values.length > 1) ?? [] };
}

export function currentValue(knob: ModelKnob, option: ModelOption): OptionValue | undefined {
	return knob.selection.options?.find((selected) => selected.id === option.id)?.value ?? option.default;
}

export function withValue(selection: ModelSelection, id: string, value: OptionValue): ModelSelection {
	const others = (selection.options ?? []).filter((selected) => selected.id !== id);
	return { ...selection, options: [...others, { id, value }] };
}

export const configure = (thread: DeckThread, modelSelection: ModelSelection) =>
	thread.source.call("t3_thread_configure", { threadId: thread.threadId, modelSelection });
