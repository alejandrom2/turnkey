import streamDeck, { type Action, action, type KeyUpEvent, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { editorLabel, knownEditors, openInEditorInput, pickEditor } from "../core/editors.js";
import { gitCwd } from "../core/git.js";
import { t } from "../core/i18n.js";
import { modeOf } from "../core/modes.js";
import { applyPreviewEvent, currentPreview, type HtmlRender, htmlRenderFileName, type PreviewEvent, type PreviewSession, reachableHere } from "../core/preview.js";
import { renderInfoKey, renderSkeletonKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import type { Machine } from "../core/t3/machine.js";
import { isThisComputer, OPERATE_SCOPE } from "../core/t3/pairing.js";
import { pinnedName } from "../core/target.js";
import { deck } from "../deck.js";
import { canOperate, DeckAction, machineName, machinesOn, pressWhileDisconnected, selectedThread, sendChoices } from "./base.js";
import { threadNeeds } from "./needs.js";
import { MachineWatch } from "./watch.js";
import { setCapped } from "../core/capped.js";

const ID = "com.alejandrom2.turnkey";

type OpenSettings = { machine?: string; mode?: string; editor?: string; target?: string; thread?: string; threadTitle?: string };

const isHere = (machine: Machine): boolean => isThisComputer(new URL(machine.url).hostname);
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

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

/**
 * Previews of the threads visible Open keys in Preview show. Each machine's preview events stream only while such a key
 * shows; a thread's tabs are listed when a key first shows it, its HTML render read when its runs move and it has no
 * preview tab.
 */
class Previews {
	readonly #threads = new Map<string, ThreadPreview>();
	readonly watch = new MachineWatch({
		open: (machine) => machine.live("subscribePreviewEvents", {}, (value) => this.#apply(machine, value as PreviewEvent), () => this.#forget(machine)),
		closed: (machine) => this.#forget(machine),
	});

	/** A new connection may have missed events: list again on next use. */
	#forget(machine: Machine): void {
		for (const key of this.#threads.keys()) if (key.startsWith(`${machine.environmentId}/`)) this.#threads.delete(key);
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
		setCapped(this.#threads, thread.key, entry);
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

const previews = new Previews();

/**
 * Opens the selected thread's worktree (else its project's root) in an editor through `shell.openInEditor`, or the
 * target thread's preview in this computer's browser: the page its preview panel shows, else its newest HTML render
 * (its In setting). T3 Code launches an editor on its own machine, and a page on the loopback address of another
 * machine only opens there, so the key says where.
 */
abstract class OpenAction extends DeckAction<OpenSettings> {
	protected override readonly watcher = previews.watch;

	#previews(action: Action<OpenSettings>): boolean {
		return modeOf("open", this.manifestId, this.settingsOf(action)) === "preview";
	}

	/** Only a key in Preview streams its machine's preview events. */
	protected override watched(action: Action<OpenSettings>): readonly Machine[] {
		return this.#previews(action) ? machinesOn(this.machineOf(action)) : [];
	}

	#editorState(action: Action<OpenSettings>) {
		const thread = selectedThread(this.machineOf(action));
		const cwd = thread && gitCwd(thread, thread.machine.project(thread.projectId)?.workspaceRoot);
		const pick = thread && pickEditor(this.settingsOf(action).editor, thread.machine.editors);
		const reason =
			thread === undefined
				? t("reason.noThread")
				: !canOperate(thread)
					? t("reason.readOnly")
					: pick === undefined
						? t("editor.none")
						: pick.missing !== undefined
							? t("needs.notAvailable", { value: pick.missing })
							: cwd === undefined
								? t("editor.noFolder")
								: undefined;
		return { thread, cwd, pick, editor: pick?.editor, reason };
	}

	#previewState(action: Action<OpenSettings>) {
		const { thread, gone, pinned } = this.target(action);
		const found = thread === undefined || gone !== undefined ? { loading: false } : previews.of(thread);
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

	override needs(action: Action<OpenSettings>): Need[] {
		const machine = this.machineOf(action);
		if (this.#previews(action)) {
			const { thread, pinned, preview, render, loading } = this.#previewState(action);
			return [
				...threadNeeds(machine, thread, false, pinned ? pinnedName(this.settingsOf(action)) : undefined),
				{ kind: "preview", ok: thread === undefined ? false : loading ? undefined : preview !== undefined || render !== undefined },
			];
		}
		const { thread, pick } = this.#editorState(action);
		const saved = this.settingsOf(action).editor;
		return [
			...threadNeeds(machine, thread),
			{ kind: "editor", ok: thread !== undefined && knownEditors(thread.machine.editors).length > 0 },
			...(saved && thread ? [{ kind: "value", value: editorLabel(saved), ok: pick?.missing === undefined } satisfies Need] : []),
		];
	}

	protected override async draw(action: Action<OpenSettings>): Promise<void> {
		if (!action.isKey()) return;
		if (this.#previews(action)) {
			const { preview, render, loading, reason, pinned } = this.#previewState(action);
			if (loading && reason === undefined) return void (await this.setImage(action, renderSkeletonKey()));
			const title = preview?.title ?? render?.title ?? t("openPreview.title");
			const detail = reason ?? (preview !== undefined ? new URL(preview.url).host : t("openPreview.htmlRender"));
			return void (await this.setImage(action, renderInfoKey({ glyph: "preview", title, detail, available: reason === undefined, pinned })));
		}
		const { thread, cwd, editor, reason } = this.#editorState(action);
		const title = editor ? editorLabel(editor) : t("editor.title");
		if (reason !== undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "editor", title, detail: reason, available: false })));
		const detail = isHere(thread!.machine) ? folderName(cwd!) : t("editor.opensOn", { machine: machineName(thread!.machine) });
		await this.setImage(action, renderInfoKey({ glyph: "editor", title, detail }));
	}

	override async onKeyUp(ev: KeyUpEvent<OpenSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		if (this.#previews(ev.action)) {
			const { thread, preview, render, loading, reason } = this.#previewState(ev.action);
			if (reason !== undefined) return void (await this.flash(ev.action, false, reason));
			if (loading) return void (await this.flash(ev.action, false, t("result.loading")));
			return void (await this.run(ev.action, async () => {
				const url =
					preview?.url ??
					(await thread!.machine.assetUrl({ _tag: "attachment", attachmentId: render!.attachmentId, fileName: htmlRenderFileName(render!.title), mimeType: "text/html", disposition: "inline" }));
				await streamDeck.system.openUrl(url);
			}));
		}
		const { thread, cwd, editor, reason } = this.#editorState(ev.action);
		if (reason !== undefined) return void (await this.flash(ev.action, false, reason));
		await this.run(ev.action, () => thread!.machine.call("shell.openInEditor", openInEditorInput(cwd!, editor!), OPERATE_SCOPE));
	}

	/** The Editor setting's choices: T3 Code's default, then every editor the action's machines have. */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, OpenSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== "getEditors") return super.onSendToPlugin(ev);
		await deck.refreshConfigs(this.machineOf(ev.action));
		const machine = this.machineOf(ev.action);
		const available = [...new Set(machinesOn(machine).flatMap((candidate) => knownEditors(candidate.editors)))];
		const items = [{ label: t("datasource.defaultEditor"), value: "" }, ...knownEditors(available).map((id) => ({ label: editorLabel(id), value: id }))];
		await sendChoices("getEditors", items, this.settingsOf(ev.action).editor, (saved) => t("needs.notAvailable", { value: editorLabel(saved) }));
	}
}

@action({ UUID: `${ID}.open` })
export class OpenKey extends OpenAction {}

// Open in Editor and Open Preview, which Open replaced: hidden from the actions list, still on decks and in older profiles.
@action({ UUID: `${ID}.editor` })
export class OpenInEditor extends OpenAction {}

@action({ UUID: `${ID}.preview` })
export class OpenPreview extends OpenAction {}
