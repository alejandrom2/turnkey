import streamDeck, { type Action, action, type DidReceiveSettingsEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { applyPreviewEvent, currentPreview, type HtmlRender, htmlRenderFileName, type PreviewEvent, type PreviewSession, reachableHere } from "../core/preview.js";
import { renderInfoKey, renderSkeletonKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import type { Machine } from "../core/t3/machine.js";
import { isThisComputer } from "../core/t3/pairing.js";
import { pinnedName } from "../core/target.js";
import { deck } from "../deck.js";
import { connectionFace, DeckAction, pressWhileDisconnected } from "./base.js";
import { threadNeeds } from "./needs.js";

const ID = "com.alejandrom2.t3deck";

type PreviewSettings = { machine?: string; target?: string; thread?: string; threadTitle?: string };

/** What the deck knows of one thread's preview: its tabs (from `preview.list`, then events) and its newest HTML render. */
type ThreadPreview = {
	sessions?: PreviewSession[];
	revision: number;
	listing: boolean;
	/** null once read and none found. */
	render?: HtmlRender | null;
	/** The runs the render was read at; it is read again when they move. */
	renderStamp?: string;
	rendering: boolean;
};

const machineName = (machine: Machine): string => (machine.state.kind === "ready" ? machine.state.label : new URL(machine.url).host);
const isHere = (machine: Machine): boolean => isThisComputer(new URL(machine.url).hostname);

/**
 * Previews of the threads visible Open Preview keys show. Each machine's preview events stream only while such a key
 * shows; a thread's tabs are listed when a key first shows it, its HTML render read when its runs move and it has no
 * preview tab.
 */
class PreviewWatch {
	readonly #shown = new Map<string, string | undefined>();
	readonly #streams = new Map<string, () => void>();
	readonly #threads = new Map<string, ThreadPreview>();

	show(id: string, url: string | undefined): void {
		this.#shown.set(id, url);
		this.sync();
	}

	hide(id: string): void {
		this.#shown.delete(id);
		this.sync();
	}

	sync(): void {
		const urls = [...this.#shown.values()];
		const wanted = new Set(deck.machines.filter((machine) => urls.some((url) => url === undefined || url === machine.url)).map((machine) => machine.url));
		for (const [url, release] of this.#streams) {
			if (wanted.has(url)) continue;
			release();
			this.#streams.delete(url);
			this.#forget(url);
		}
		for (const machine of deck.machines) {
			if (!wanted.has(machine.url) || this.#streams.has(machine.url)) continue;
			this.#streams.set(
				machine.url,
				machine.live("subscribePreviewEvents", {}, (value) => this.#apply(machine, value as PreviewEvent), () => this.#forget(machine.url)),
			);
		}
	}

	/** A new connection may have missed events: list again on next use. */
	#forget(url: string): void {
		const environmentId = deck.machines.find((machine) => machine.url === url)?.environmentId;
		for (const key of this.#threads.keys()) if (key.startsWith(`${environmentId}/`)) this.#threads.delete(key);
	}

	#apply(machine: Machine, event: PreviewEvent): void {
		const entry = this.#threads.get(`${machine.environmentId}/${event.threadId}`);
		if (entry?.sessions === undefined || event.revision <= entry.revision) return;
		entry.sessions = applyPreviewEvent(entry.sessions, event);
		entry.revision = event.revision;
		deck.repaint();
	}

	/** The thread's preview as last known; starts the reads it is missing. Only call it for a thread a visible key shows. */
	of(thread: DeckThread): { preview?: { url: string; title: string }; render?: HtmlRender; loading: boolean } {
		const entry = this.#threads.get(thread.key) ?? { revision: 0, listing: false, rendering: false };
		this.#threads.set(thread.key, entry);
		if (entry.sessions === undefined) {
			this.#list(thread, entry);
			return { loading: true };
		}
		const preview = currentPreview(entry.sessions);
		if (preview !== undefined) return { preview, loading: false };
		const stamp = `${thread.latestRunId}|${thread.active}`;
		if (entry.renderStamp !== stamp) this.#readRender(thread, entry, stamp);
		return { render: entry.render ?? undefined, loading: entry.render === undefined };
	}

	#list(thread: DeckThread, entry: ThreadPreview): void {
		if (entry.listing) return;
		entry.listing = true;
		thread.machine
			.call<{ sessions?: PreviewSession[]; revision?: number }>("preview.list", { threadId: thread.threadId })
			.then(
				(listed) => {
					entry.sessions = listed.sessions ?? [];
					entry.revision = listed.revision ?? 0;
				},
				// An older T3 Code has no previews: treat it as none.
				() => {
					entry.sessions = [];
				},
			)
			.finally(() => {
				entry.listing = false;
				deck.repaint();
			});
	}

	#readRender(thread: DeckThread, entry: ThreadPreview, stamp: string): void {
		if (entry.rendering) return;
		entry.rendering = true;
		thread.machine
			.htmlRender(thread)
			.then(
				(render) => {
					entry.render = render ?? null;
				},
				() => {
					entry.render ??= null;
				},
			)
			.finally(() => {
				entry.rendering = false;
				entry.renderStamp = stamp;
				deck.repaint();
			});
	}
}

const watch = new PreviewWatch();
deck.onRepaint(() => watch.sync());

/**
 * Opens the target thread's preview in this computer's browser: the page its preview panel shows, else its newest
 * HTML render. A page on the loopback address of another machine only opens there, so the key says so.
 */
@action({ UUID: `${ID}.preview` })
export class OpenPreview extends DeckAction<PreviewSettings> {
	#state(action: Action<PreviewSettings>) {
		const { thread, gone, pinned } = this.target(action);
		const found = thread === undefined || gone !== undefined ? { loading: false } : watch.of(thread);
		const remoteOnly = found.preview !== undefined && !reachableHere(found.preview.url, isHere(thread!.machine));
		const reason =
			gone ??
			(thread === undefined
				? t("reason.noThread")
				: found.loading
					? undefined
					: remoteOnly
						? t("openPreview.onlyOn", { machine: machineName(thread.machine) })
						: found.preview === undefined && found.render === undefined
							? t("openPreview.none")
							: undefined);
		return { thread, pinned, ...found, reason };
	}

	override needs(action: Action<PreviewSettings>): Need[] {
		const { thread, preview, render, loading } = this.#state(action);
		const target = this.target(action);
		return [
			...threadNeeds(this.machineOf(action), thread, false, target.pinned ? pinnedName(this.settingsOf(action)) : undefined),
			{ kind: "preview", ok: thread === undefined ? false : loading ? undefined : preview !== undefined || render !== undefined },
		];
	}

	protected override async paint(action: Action<PreviewSettings>): Promise<void> {
		if (!action.isKey()) return;
		const offline = connectionFace(this.machineOf(action));
		if (offline) return void (await this.setImage(action, offline));
		const { preview, render, loading, reason, pinned } = this.#state(action);
		if (loading && reason === undefined) return void (await this.setImage(action, renderSkeletonKey()));
		const title = preview?.title ?? render?.title ?? t("openPreview.title");
		const detail = reason ?? (preview !== undefined ? new URL(preview.url).host : t("openPreview.htmlRender"));
		await this.setImage(action, renderInfoKey({ glyph: "preview", title, detail, available: reason === undefined, pinned }));
	}

	override async onKeyUp(ev: KeyUpEvent<PreviewSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, preview, render, loading, reason } = this.#state(ev.action);
		if (reason !== undefined) return void (await this.flash(ev.action, false, reason));
		if (loading) return void (await this.flash(ev.action, false, t("result.loading")));
		await this.run(ev.action, async () => {
			const url =
				preview?.url ??
				(await thread!.machine.assetUrl({ _tag: "attachment", attachmentId: render!.attachmentId, fileName: htmlRenderFileName(render!.title), mimeType: "text/html", disposition: "inline" }));
			await streamDeck.system.openUrl(url);
		});
	}

	override onWillAppear(ev: WillAppearEvent<PreviewSettings>): void {
		super.onWillAppear(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<PreviewSettings>): void {
		super.onDidReceiveSettings(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
	}

	override onWillDisappear(ev: WillDisappearEvent<PreviewSettings>): void {
		watch.hide(ev.action.id);
		super.onWillDisappear(ev);
	}
}
