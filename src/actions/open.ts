import { type Action, action, type SendToPluginEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { editorLabel, knownEditors } from "../core/editors.js";
import { t } from "../core/i18n.js";
import { openKey, type OpenSettings, type OpenState } from "../core/keys/open.js";
import { modeOf } from "../core/modes.js";
import type { Need } from "../core/requirements.js";
import type { Machine } from "../core/t3/machine.js";
import { pinnedName } from "../core/target.js";
import type { MachineWatch } from "../core/watch.js";
import { deck } from "../deck.js";
import { machinesOn, sendChoices } from "./base.js";
import { threadNeeds } from "./needs.js";
import { SharedKey } from "./shared.js";
import { DeckWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";

/** One watch for every Open class: a machine's preview events stream once, however many keys show its previews. */
const previewWatch = new DeckWatch(openKey.watch!);

/**
 * Opens the selected thread's worktree (else its project's root) in an editor, or the target thread's preview in this
 * computer's browser (`openKey`).
 */
abstract class OpenAction extends SharedKey<OpenSettings, OpenState> {
	protected readonly definition = openKey;

	/** Open in Editor and Open Preview, saved before Open had a mode, act as their UUID says. */
	protected override definitionSettings(action: Action<OpenSettings>): OpenSettings {
		const settings = this.settingsOf(action);
		return { ...settings, mode: modeOf("open", this.manifestId, settings) };
	}

	protected override watching(): MachineWatch {
		return previewWatch;
	}

	#previews(action: Action<OpenSettings>): boolean {
		return modeOf("open", this.manifestId, this.settingsOf(action)) === "preview";
	}

	/** Only a key in Preview streams its machine's preview events. */
	protected override watched(action: Action<OpenSettings>): readonly Machine[] {
		return this.#previews(action) ? machinesOn(this.machineOf(action)) : [];
	}

	override needs(action: Action<OpenSettings>): Need[] {
		const machine = this.machineOf(action);
		const state = this.stateOf(action);
		if (state.mode === "preview") {
			const { thread, pinned, preview, render, loading } = state;
			return [
				...threadNeeds(machine, thread, false, pinned ? pinnedName(this.settingsOf(action)) : undefined),
				{ kind: "preview", ok: thread === undefined ? false : loading ? undefined : preview !== undefined || render !== undefined },
			];
		}
		const { thread, pick } = state;
		const saved = this.settingsOf(action).editor;
		return [
			...threadNeeds(machine, thread),
			{ kind: "editor", ok: thread !== undefined && knownEditors(thread.machine.editors).length > 0 },
			...(saved && thread ? [{ kind: "value", value: editorLabel(saved), ok: pick?.missing === undefined } satisfies Need] : []),
		];
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
