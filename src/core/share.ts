/**
 * Guest links (packages/contracts/src/guestShare.ts): one browser outside watches a thread over T3 Connect and
 * proposes messages the owner sends or dismisses. A link is shown once, when it is made; making another ends the
 * current one. The share lives on the thread's projection, not the shell, so it is read on demand.
 */
import { launch } from "./commands.js";
import { type MessageKey, t } from "./i18n.js";
import { setCapped } from "./capped.js";

/** `ThreadGuestShare`, the fields the deck reads. */
export type GuestShare = { id: string; expiresAt: string; guestName: string | null; messages?: { status: string }[] };

/** The share on a bounded thread snapshot (`OrchestrationV2ThreadProjection.thread.guestShare`). */
export function readGuestShare(projection: unknown): GuestShare | null {
	const share = (projection as { thread?: { guestShare?: unknown } } | undefined)?.thread?.guestShare as Partial<GuestShare> | null | undefined;
	if (share == null || typeof share.id !== "string" || typeof share.expiresAt !== "string") return null;
	return { id: share.id, expiresAt: share.expiresAt, guestName: typeof share.guestName === "string" ? share.guestName : null, messages: Array.isArray(share.messages) ? share.messages : [] };
}

/** What a Share key shows: not shared, a live link (with its guest once one joined), or one past its 24 hours. */
export type ShareView = { kind: "none" } | { kind: "active"; guest: string | null; pending: number } | { kind: "expired" };

/** The share stays on the thread after it expires, until the owner stops it (GuestShareControls.tsx). */
export function shareView(share: GuestShare | null | undefined, now: number): ShareView {
	if (share == null) return { kind: "none" };
	if (!(Date.parse(share.expiresAt) > now)) return { kind: "expired" };
	return { kind: "active", guest: share.guestName, pending: (share.messages ?? []).filter((message) => message.status === "pending").length };
}

const CREATE_FAILURE: Record<string, MessageKey> = {
	disabled: "share.disabled",
	connect_unavailable: "share.noConnect",
	thread_unavailable: "share.unavailable",
};

/** `GuestShareCreateError`'s reason as a few words for the key. */
export const shareFailure = (code: string | undefined): string | undefined => (code !== undefined && code in CREATE_FAILURE ? t(CREATE_FAILURE[code]!) : undefined);

/** Linux has no one clipboard tool: Wayland's `wl-copy`, else X11's `xclip`. */
function clipboardCommand(platform: NodeJS.Platform): [string | undefined, string[]] {
	if (platform === "darwin") return ["pbcopy", []];
	if (platform === "win32") return ["clip", []];
	if (platform === "linux") return process.env.WAYLAND_DISPLAY ? ["wl-copy", []] : ["xclip", ["-selection", "clipboard"]];
	return [undefined, []];
}

/** Copies `text` with the OS's own tool; Stream Deck has no clipboard API. */
export function copyText(text: string, platform: NodeJS.Platform = process.platform): Promise<void> {
	const [command, args] = clipboardCommand(platform);
	if (command === undefined) return Promise.reject(new Error("No clipboard tool on this system."));
	return launch(command, args, text);
}

/** One read per thread at a time, read again once its stamp moves. */
type Entry = { wanted: string; read?: string; share?: GuestShare | null; loading: boolean };

/** Shares of the threads visible Share keys show. */
export class ShareStore {
	readonly #entries = new Map<string, Entry>();

	constructor(private readonly onChange: () => void) {}

	/**
	 * The share as last read: null when there is none, undefined until the first read lands. `stamp` changes when the
	 * share may have: opening or closing one moves the thread's row.
	 */
	of(thread: { key: string; stamp: string }, read: () => Promise<GuestShare | null>): GuestShare | null | undefined {
		const entry = this.#entries.get(thread.key) ?? { wanted: thread.stamp, loading: false };
		setCapped(this.#entries, thread.key, entry);
		entry.wanted = thread.stamp;
		this.#load(thread.key, entry, read);
		return entry.share;
	}

	/** Takes what the deck just did as read, so the face doesn't wait for the next read. */
	set(key: string, share: GuestShare | null): void {
		const entry = this.#entries.get(key);
		if (entry === undefined) return;
		entry.share = share;
		this.onChange();
	}


	#load(key: string, entry: Entry, read: () => Promise<GuestShare | null>): void {
		if (entry.loading || entry.read === entry.wanted) return;
		const stamp = entry.wanted;
		entry.loading = true;
		read()
			.then(
				(share) => {
					entry.share = share;
					entry.read = stamp;
				},
				// A failed read keeps what was shown; the next change reads again.
				() => {
					entry.read = stamp;
				},
			)
			.finally(() => {
				entry.loading = false;
				if (this.#entries.get(key) !== entry) return;
				this.#load(key, entry, read);
				this.onChange();
			});
	}
}
