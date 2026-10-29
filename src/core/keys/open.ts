import type { DeckThread } from "../board.js";
import { setCapped } from "../capped.js";
import { editorLabel, type EditorId, openInEditorInput, pickEditor } from "../editors.js";
import { gitCwd } from "../git.js";
import { t } from "../i18n.js";
import { modeOf } from "../modes.js";
import { applyPreviewEvent, currentPreview, type HtmlRender, htmlRenderFileName, type PreviewEvent, type PreviewSession, reachableHere } from "../preview.js";
import { renderInfoKey, renderSkeletonKey } from "../render.js";
import { type Machine, machineName } from "../t3/machine.js";
import { isThisComputer, OPERATE_SCOPE } from "../t3/pairing.js";
import type { KeyDefinition } from "./key.js";

export type OpenSettings = { machine?: string; mode?: string; editor?: string; target?: string; thread?: string; threadTitle?: string };

const isHere = (machine: Machine): boolean => isThisComputer(new URL(machine.url).hostname);
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/** What the host knows of one thread's preview: its tabs (from `preview.list`, then events) and its newest HTML render. */
type ThreadPreview = {
	sessions?: PreviewSession[];
	revision: number;
	listing: boolean;
	/** The runs the tabs were listed at; listed again when they move while no events stream. */
	listStamp?: string;
	/** null once read and none found. */
	render?: HtmlRender | null;
	/** The runs the render was read at; it is read again when they move. */
	renderStamp?: string;
	rendering: boolean;
};

const runsOf = (thread: DeckThread): string => `${thread.latestRunId}|${thread.active}`;

/**
 * Previews of the threads visible Open keys in Preview show. Each machine's preview events stream only while such a key
 * shows (Stream Deck); a thread's tabs are listed when a key first shows it, and again when its runs move while nothing
 * streams (Logitech, which keeps no watches), its HTML render read when its runs move and it has no preview tab.
 */
class Previews {
	readonly #threads = new Map<string, ThreadPreview>();
	/** Machines whose preview events stream, by environment. */
	readonly #streaming = new Set<string>();
	// shortcut: one repaint per process, the latest runtime's; pass it per entry if a process ever hosts two runtimes.
	#repaint: () => void = () => undefined;

	readonly watch = {
		open: (machine: Machine) => {
			if (machine.environmentId !== undefined) this.#streaming.add(machine.environmentId);
			return machine.live(
				"subscribePreviewEvents",
				{},
				(value) => this.#apply(machine, value as PreviewEvent),
				() => this.#forget(machine),
			);
		},
		closed: (machine: Machine) => this.#forget(machine),
	};

	/** A new connection may have missed events: list again on next use. */
	#forget(machine: Machine): void {
		if (machine.environmentId !== undefined) this.#streaming.delete(machine.environmentId);
		for (const key of this.#threads.keys()) if (key.startsWith(`${machine.environmentId}/`)) this.#threads.delete(key);
	}

	#apply(machine: Machine, event: PreviewEvent): void {
		const entry = this.#threads.get(`${machine.environmentId}/${event.threadId}`);
		if (entry?.sessions === undefined || event.revision <= entry.revision) return;
		entry.sessions = applyPreviewEvent(entry.sessions, event);
		entry.revision = event.revision;
		this.#repaint();
	}

	/** The thread's preview as last known; starts the reads it is missing. Only call it for a thread a visible key shows. */
	of(thread: DeckThread, repaint: () => void): { preview?: { url: string; title: string }; render?: HtmlRender; loading: boolean } {
		this.#repaint = repaint;
		const entry = this.#threads.get(thread.key) ?? { revision: 0, listing: false, rendering: false };
		setCapped(this.#threads, thread.key, entry);
		const stamp = runsOf(thread);
		if (entry.sessions === undefined) {
			this.#list(thread, entry, stamp);
			return { loading: true };
		}
		if (entry.listStamp !== stamp && !this.#streaming.has(thread.environmentId)) this.#list(thread, entry, stamp);
		const preview = currentPreview(entry.sessions);
		if (preview !== undefined) return { preview, loading: false };
		if (entry.renderStamp !== stamp) this.#readRender(thread, entry, stamp);
		return { render: entry.render ?? undefined, loading: entry.render === undefined };
	}

	#list(thread: DeckThread, entry: ThreadPreview, stamp: string): void {
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
				entry.listStamp = stamp;
				this.#repaint();
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
				this.#repaint();
			});
	}
}

const previews = new Previews();

export type OpenState =
	| { mode: "editor"; thread: DeckThread | undefined; cwd: string | undefined; pick: ReturnType<typeof pickEditor>; editor: EditorId | undefined; reason: string | undefined }
	| { mode: "preview"; thread: DeckThread | undefined; pinned: boolean; preview?: { url: string; title: string }; render?: HtmlRender; loading: boolean; reason: string | undefined };

/**
 * Opens the selected thread's worktree (else its project's root) in an editor through `shell.openInEditor`, or the
 * target thread's preview in this computer's browser: the page its preview panel shows, else its newest HTML render
 * (its In setting). T3 Code launches an editor on its own machine, and a page on the loopback address of another
 * machine only opens there, so the key says where. With no Editor setting it opens T3 Code's default, the first
 * editor the machine has in T3 Code's order.
 */
export const openKey: KeyDefinition<OpenSettings, OpenState> = {
	state(ctx) {
		if (modeOf("open", undefined, ctx.settings) === "preview") {
			const { thread, gone, pinned } = ctx.target();
			const found = thread === undefined || gone !== undefined ? { loading: false } : previews.of(thread, ctx.runtime.repaint);
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
			return { mode: "preview", thread, pinned, ...found, reason };
		}
		const thread = ctx.runtime.board.selectedOn(ctx.machine);
		const cwd = thread && gitCwd(thread, thread.machine.project(thread.projectId)?.workspaceRoot);
		const pick = thread && pickEditor(ctx.settings.editor, thread.machine.editors);
		const reason =
			thread === undefined
				? t("reason.noThread")
				: !thread.machine.canOperate
					? t("reason.readOnly")
					: pick === undefined
						? t("editor.none")
						: pick.missing !== undefined
							? t("needs.notAvailable", { value: pick.missing })
							: cwd === undefined
								? t("editor.noFolder")
								: undefined;
		return { mode: "editor", thread, cwd, pick, editor: pick?.editor, reason };
	},

	tile(state) {
		if (state.mode === "preview") {
			const { preview, render, loading, reason, pinned } = state;
			if (loading && reason === undefined) return renderSkeletonKey();
			const title = preview?.title ?? render?.title ?? t("openPreview.title");
			const detail = reason ?? (preview !== undefined ? new URL(preview.url).host : t("openPreview.htmlRender"));
			return renderInfoKey({ glyph: "preview", title, detail, available: reason === undefined, pinned });
		}
		const { thread, cwd, editor, reason } = state;
		const title = editor ? editorLabel(editor) : t("editor.title");
		if (reason !== undefined) return renderInfoKey({ glyph: "editor", title, detail: reason, available: false });
		const detail = isHere(thread!.machine) ? folderName(cwd!) : t("editor.opensOn", { machine: machineName(thread!.machine) });
		return renderInfoKey({ glyph: "editor", title, detail });
	},

	label: (state) => state.reason ?? (state.mode === "preview" ? (state.preview?.title ?? state.render?.title) : state.editor && editorLabel(state.editor)),
	available: (state) => state.reason === undefined && (state.mode === "editor" || !state.loading),

	press(state, ctx) {
		if (state.reason !== undefined) return { kind: "fail", label: state.reason };
		if (state.mode === "preview") {
			if (state.loading) return { kind: "fail", label: t("result.loading") };
			const { thread, preview, render } = state;
			return {
				kind: "run",
				work: async () => {
					const url =
						preview?.url ??
						(await thread!.machine.assetUrl({ _tag: "attachment", attachmentId: render!.attachmentId, fileName: htmlRenderFileName(render!.title), mimeType: "text/html", disposition: "inline" }));
					await ctx.runtime.openUrl(url);
				},
			};
		}
		const { thread, cwd, editor } = state;
		return { kind: "run", work: () => thread!.machine.call("shell.openInEditor", openInEditorInput(cwd!, editor!), OPERATE_SCOPE) };
	},

	watch: previews.watch,
};
