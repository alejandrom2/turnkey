import streamDeck, { type Action, action, type KeyUpEvent, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { editorLabel, knownEditors, openInEditorInput, pickEditor } from "../core/editors.js";
import { gitCwd } from "../core/git.js";
import { t } from "../core/i18n.js";
import { renderInfoKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import type { Machine } from "../core/t3/machine.js";
import { isThisComputer, OPERATE_SCOPE } from "../core/t3/pairing.js";
import { deck } from "../deck.js";
import { canOperate, connectionFace, DeckAction, pressWhileDisconnected, selectedThread } from "./base.js";
import { threadNeeds } from "./needs.js";

const ID = "com.alejandrom2.t3deck";

type EditorSettings = { machine?: string; editor?: string };

const machineName = (machine: Machine): string => (machine.state.kind === "ready" ? machine.state.label : new URL(machine.url).host);
const remote = (machine: Machine): boolean => !isThisComputer(new URL(machine.url).hostname);
const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;

/**
 * Opens the selected thread's worktree, else its project's root, in an editor through `shell.openInEditor`. T3 Code
 * launches it on its own machine, so a remote machine's key says where it opens.
 */
@action({ UUID: `${ID}.editor` })
export class OpenInEditor extends DeckAction<EditorSettings> {
	#state(action: Action<EditorSettings>) {
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
		return { thread, cwd, editor: pick?.editor, reason };
	}

	protected override async paint(action: Action<EditorSettings>): Promise<void> {
		if (!action.isKey()) return;
		const offline = connectionFace(this.machineOf(action));
		if (offline) return void (await this.setImage(action, offline));
		const { thread, cwd, editor, reason } = this.#state(action);
		const title = editor ? editorLabel(editor) : t("editor.title");
		if (reason !== undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "editor", title, detail: reason, available: false })));
		const detail = remote(thread!.machine) ? t("editor.opensOn", { machine: machineName(thread!.machine) }) : folderName(cwd!);
		await this.setImage(action, renderInfoKey({ glyph: "editor", title, detail }));
	}

	override async onKeyUp(ev: KeyUpEvent<EditorSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, cwd, editor, reason } = this.#state(ev.action);
		if (reason !== undefined) return void (await this.flash(ev.action, false, reason));
		await this.run(ev.action, () => thread!.machine.call("shell.openInEditor", openInEditorInput(cwd!, editor!), OPERATE_SCOPE), t("result.opened"));
	}

	/** The Editor setting's choices: T3 Code's default, then every editor the action's machines have. */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, EditorSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== "getEditors") return super.onSendToPlugin(ev);
		await deck.refreshConfigs(this.machineOf(ev.action));
		const machine = this.machineOf(ev.action);
		const available = [...new Set(deck.machines.filter((candidate) => machine === undefined || candidate.url === machine).flatMap((candidate) => knownEditors(candidate.editors)))];
		const items = [{ label: t("datasource.defaultEditor"), value: "" }, ...knownEditors(available).map((id) => ({ label: editorLabel(id), value: id }))];
		const saved = this.settingsOf(ev.action).editor;
		if (saved && !available.some((id) => id === saved)) items.push({ label: t("needs.notAvailable", { value: editorLabel(saved) }), value: saved });
		await streamDeck.ui.sendToPropertyInspector({ event: "getEditors", items });
	}

	override needs(action: Action<EditorSettings>): Need[] {
		const machine = this.machineOf(action);
		const { thread } = this.#state(action);
		const pick = thread && pickEditor(this.settingsOf(action).editor, thread.machine.editors);
		const saved = this.settingsOf(action).editor;
		return [
			...threadNeeds(machine, thread),
			{ kind: "editor", ok: thread !== undefined && knownEditors(thread.machine.editors).length > 0 },
			...(saved && thread ? [{ kind: "value", value: editorLabel(saved), ok: pick?.missing === undefined } satisfies Need] : []),
		];
	}
}
