import { spawn } from "node:child_process";
import { posix } from "node:path";

import type { DeckThread } from "./board.js";
import type { Machine, Question } from "./t3/machine.js";

export type OrganizeAction = "settle" | "pin" | "unpin" | "snooze" | "archive" | "mark_unread" | "wake";

/** `t3code://threads/<environmentId>/<threadId>`, handled by T3 Code desktop (`packages/shared/src/promptLinks.ts`). */
export function threadDeepLink(thread: Pick<DeckThread, "environmentId" | "threadId">, scheme = "t3code"): string {
	return `${scheme}://threads/${encodeURIComponent(thread.environmentId)}/${encodeURIComponent(thread.threadId)}`;
}

/** The OS's opener for `url`. */
export function openCommand(url: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
	if (platform === "win32") return ["rundll32", ["url.dll,FileProtocolHandler", url]];
	return [platform === "linux" ? "xdg-open" : "open", [url]];
}

/** Shows `path` in Finder or Explorer, selected when `select`; `xdg-open` can't select, so Linux opens the folder. */
export function revealCommand(path: string, select: boolean, platform: NodeJS.Platform = process.platform): [string, string[]] {
	if (platform === "win32") return ["explorer", [select ? `/select,${path}` : path]];
	if (platform === "linux") return ["xdg-open", [select ? posix.dirname(path) : path]];
	return ["open", select ? ["-R", path] : [path]];
}

/**
 * Runs an OS tool and settles when it exits. Not `execFile`: that waits for the output pipes to close, which a process
 * the tool leaves behind (xclip keeping the clipboard, an app xdg-open launched) holds open indefinitely.
 */
export function launch(command: string, args: readonly string[], input?: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { stdio: [input === undefined ? "ignore" : "pipe", "ignore", "ignore"] });
		child.once("error", reject);
		child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`))));
		child.stdin?.on("error", () => undefined).end(input);
	});
}

/** Stream Deck's `openUrl` refuses custom schemes, so hand the link to the OS. */
export function openExternal(url: string): Promise<void> {
	const [command, args] = openCommand(url);
	return launch(command, args);
}

/** Selects the thread the way T3 Code's own open does, then opens it in the desktop app, without waiting on the select; a failed select still opens. */
export async function openThread(
	thread: Pick<DeckThread, "key" | "environmentId" | "threadId"> & { machine: Pick<Machine, "url"> },
	select: (key: string, url: string) => Promise<unknown>,
	scheme?: string,
	open: (url: string) => Promise<void> = openExternal,
): Promise<void> {
	try {
		void select(thread.key, thread.machine.url).catch(() => undefined);
	} catch {
		// A select that throws before returning its promise mustn't keep the thread from opening either.
	}
	await open(threadDeepLink(thread, scheme));
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
		case "wake":
			return machine.unsnooze(thread);
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
