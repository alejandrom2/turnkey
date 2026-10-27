import { t } from "./i18n.js";

/** Which thread an action acts on: T3 Code's selection (the default), or one thread picked in its settings. */
export type TargetSettings = { target?: unknown; thread?: unknown; threadTitle?: unknown };

/** What looking a pinned thread up found: it, nothing (archived or deleted), or no answer yet (its machine is offline or loading). */
export type PinnedLookup<T> = { state: "found"; thread: T } | { state: "gone" } | { state: "unknown" };

/** The thread to act on; `gone` is why a pinned one can't be, shown on the key and in the checklist. */
export type Target<T> = { thread: T | undefined; pinned: boolean; gone?: string };

/** The `${environmentId}/${threadId}` key of the thread the settings pin, if they pin one. */
export function pinnedKey(settings: TargetSettings): string | undefined {
	if (settings.target !== "thread") return undefined;
	return typeof settings.thread === "string" && settings.thread !== "" ? settings.thread : "";
}

/** How a pinned thread is named when it can't be found: its last known title, else its id. */
export function pinnedName(settings: TargetSettings): string {
	if (typeof settings.threadTitle === "string" && settings.threadTitle.trim() !== "") return settings.threadTitle.trim();
	const key = typeof settings.thread === "string" ? settings.thread : "";
	return key.slice(key.indexOf("/") + 1);
}

/** Resolves the action's target: the selection, or the pinned thread wherever it is listed, settled or snoozed. */
export function resolveTarget<T>(settings: TargetSettings, selected: () => T | undefined, lookup: (key: string) => PinnedLookup<T>): Target<T> {
	const key = pinnedKey(settings);
	if (key === undefined) return { thread: selected(), pinned: false };
	if (key === "") return { thread: undefined, pinned: true, gone: t("reason.pickThread") };
	const found = lookup(key);
	if (found.state === "found") return { thread: found.thread, pinned: true };
	return { thread: undefined, pinned: true, gone: found.state === "gone" ? t("reason.targetGone", { thread: pinnedName(settings) }) : undefined };
}
