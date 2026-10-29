import { HOLD_CONFIRM_MS } from "../approvals.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
import { COLORS, renderInfoKey } from "../render.js";
import { copyText, type GuestShare, shareFailure, ShareStore, shareView, type ShareView } from "../share.js";
import type { Machine } from "../t3/machine.js";
import { ACCESS_SCOPE } from "../t3/pairing.js";
import { RpcError } from "../t3/rpc.js";
import { accessFace, accessPlan, awaitingPairing } from "./access.js";
import type { KeyContext, KeyDefinition, KeyRuntime } from "./key.js";

export type ShareSettings = { machine?: string; target?: string; thread?: string; threadTitle?: string };

// shortcut: one repaint per process, the latest runtime's; keep a store per runtime if a process ever hosts two.
let repaint: () => void = () => undefined;

/** Shares of the threads visible Share keys show. */
const shares = new ShareStore(() => repaint());

/** Links this host made, by thread key: T3 Code shows a link once, so only these can be copied again. Never persisted or logged. */
const links = new Map<string, { shareId: string | undefined; url: string }>();

/** The link this host made for `thread`, for Stream Deck's inspector: it is a credential. */
export const linkOf = (thread: DeckThread | undefined): string | undefined => (thread === undefined ? undefined : links.get(thread.key)?.url);

/** Stream Deck shows the link in the open inspector of the key that made or closed it; Logitech has none. */
let linkChanged: (instance: string | undefined) => Promise<void> = async () => undefined;
export const onLinkChange = (listener: (instance: string | undefined) => Promise<void>): void => void (linkChanged = listener);

/** Copies a link; a failed copy still leaves it in the inspector. */
async function copied(runtime: Pick<KeyRuntime, "warn">, url: string): Promise<void> {
	try {
		await copyText(url);
	} catch (error) {
		runtime.warn(`Copying the guest link failed: ${error instanceof Error ? error.message : String(error)}`);
		throw new RpcError("Copy", "Copying failed.", t("share.copyFailed"));
	}
}

export type ShareState = { thread: DeckThread | undefined; share: GuestShare | null | undefined; view: ShareView | undefined; reason: string | undefined; pinned: boolean };


async function close(ctx: KeyContext<ShareSettings>, thread: DeckThread): Promise<void> {
	await thread.machine.closeGuestLink(thread);
	links.delete(thread.key);
	shares.set(thread.key, null);
	await linkChanged(ctx.instance);
}

async function create(ctx: KeyContext<ShareSettings>, thread: DeckThread): Promise<void> {
	let created: Awaited<ReturnType<Machine["createGuestLink"]>>;
	try {
		created = await thread.machine.createGuestLink(thread);
	} catch (error) {
		const reason = error instanceof RpcError ? shareFailure(error.code) : undefined;
		throw reason === undefined ? error : new RpcError((error as RpcError).tag, (error as RpcError).message, reason);
	}
	links.set(thread.key, { shareId: created.share?.id, url: created.url });
	shares.set(thread.key, created.share);
	await linkChanged(ctx.instance);
	await copied(ctx.runtime, created.url);
}

/**
 * Makes a guest link for the target thread and copies it, as T3 Code's Share with guest does; a shared thread shows
 * "Shared", its guest and waiting messages. Hold stops sharing. Needs access a standard pairing doesn't ask for.
 */
export const shareKey: KeyDefinition<ShareSettings, ShareState> = {
	state(ctx) {
		repaint = ctx.runtime.repaint;
		const target = ctx.target();
		const thread = target.thread;
		// A running thread's row moves with every event; its share is read again when its runs move instead.
		const share = thread && shares.of({ key: thread.key, stamp: thread.active ? thread.runStamp : String(thread.updatedAt) }, () => thread.machine.guestShare(thread));
		const view = share === undefined ? undefined : shareView(share, Date.now());
		const reason = target.gone ?? (thread === undefined ? t("reason.noThread") : view?.kind === "none" && !thread.machine.guestLinksEnabled ? t("share.disabled") : undefined);
		return { thread, share, view, reason, pinned: target.pinned };
	},

	tile({ thread, view, reason, pinned }, ctx) {
		const title = thread?.title ?? t("share.title");
		if (reason !== undefined || thread === undefined) return renderInfoKey({ glyph: "share", title: t("share.title"), detail: reason, available: false, pinned });
		if (view === undefined || view.kind === "none") {
			if (view !== undefined && awaitingPairing(ctx.runtime, thread.machine, [ACCESS_SCOPE])) return accessFace("share", t("share.needsAccess"));
			return renderInfoKey({ glyph: "share", title: t("share.title"), detail: title, available: view !== undefined, pinned });
		}
		if (view.kind === "expired") return renderInfoKey({ glyph: "guest", color: COLORS.muted, title: t("share.expired"), detail: t("share.holdToClear"), pinned });
		const detail = view.pending > 0 ? (view.pending === 1 ? t("share.pendingOne") : t("share.pending", { count: view.pending })) : view.guest !== null ? t("share.guest", { name: view.guest }) : t("share.unused");
		return renderInfoKey({ glyph: "guest", color: view.pending > 0 ? COLORS.attention : COLORS.done, tint: view.pending > 0 ? COLORS.attention : undefined, title: t("share.shared"), detail, pinned });
	},

	label: ({ thread, reason }) => reason ?? thread?.title,
	available: ({ thread, view, reason }) => reason === undefined && thread !== undefined && view !== undefined,

	// Guest links may have been turned on in Labs since the config was read; nothing keeps it live here.
	async prepare(ctx) {
		const thread = ctx.target().thread;
		if (thread !== undefined && !thread.machine.guestLinksEnabled) await ctx.runtime.refreshConfigs(thread.machine.url);
	},

	press({ thread, share, view, reason }, ctx, input) {
		if (reason !== undefined || thread === undefined) return { kind: "fail", label: reason ?? t("failure.failed") };
		if (view === undefined) return { kind: "nothing" };
		if (view.kind !== "none") {
			// A hold stops sharing, on Stream Deck or a keypad; a Ring click can't hold, so it never stops.
			if (input.heldMs >= HOLD_CONFIRM_MS) return { kind: "run", work: () => close(ctx, thread) };
			const link = links.get(thread.key);
			if (view.kind === "active" && link !== undefined && link.shareId === share?.id) return { kind: "run", work: () => copied(ctx.runtime, link.url) };
			return { kind: "fail", label: t(view.kind === "expired" ? "share.holdToClear" : "share.holdToStop") };
		}
		const access = accessPlan(ctx.runtime, thread.machine, [ACCESS_SCOPE]);
		if (access !== undefined) return access;
		return { kind: "run", work: () => create(ctx, thread) };
	},
};
