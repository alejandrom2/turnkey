import { execFile } from "node:child_process";

import type { DeckThread } from "./board.js";
import type { Question } from "./t3/machine.js";

export type OrganizeAction = "settle" | "pin" | "unpin" | "snooze" | "archive" | "mark_unread";

/** `t3code://threads/<environmentId>/<threadId>`, handled by T3 Code desktop (`packages/shared/src/promptLinks.ts`). */
export function threadDeepLink(thread: Pick<DeckThread, "environmentId" | "threadId">, scheme = "t3code"): string {
	return `${scheme}://threads/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.threadId)}`;
}

/** Stream Deck's `openUrl` refuses custom schemes, so hand the link to the OS. */
export function openExternal(url: string): Promise<void> {
	const [command, args] = process.platform === "win32" ? ["rundll32", ["url.dll,FileProtocolHandler", url]] : ["open", [url]];
	return new Promise((resolve, reject) => execFile(command, args, (error) => (error ? reject(error) : resolve())));
}

export function organize(thread: DeckThread, action: OrganizeAction, snoozeMinutes = 60): Promise<unknown> {
	const { machine } = thread;
	switch (action) {
		case "settle":
			return machine.settle(thread);
		case "pin":
			return machine.pin(thread);
		case "unpin":
			return machine.unpin(thread);
		case "snooze":
			return machine.snooze(thread, snoozeMinutes);
		case "archive":
			return machine.archive(thread);
		case "mark_unread":
			return machine.markUnread(thread);
	}
}

/** An option's answer is its value, else its label (apps/web/src/pendingUserInput.ts). */
export const answerValue = (option: Question["options"][number]): string => option.value ?? option.label;

/**
 * Answers keyed by question id, from one picked option per question. Multi-select takes an array,
 * except for message-mode questions, which T3 Code turns into a reply and needs as plain strings.
 */
export function buildAnswers(questions: readonly Question[], picks: readonly number[], messageMode: boolean): Record<string, string | string[]> {
	return Object.fromEntries(
		questions.map((question, index) => {
			const option = question.options[picks[index] ?? 0];
			const value = option === undefined ? "" : answerValue(option);
			return [question.id, question.multiSelect && !messageMode ? [value] : value];
		}),
	);
}
