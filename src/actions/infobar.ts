import type { Action } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { t } from "../core/i18n.js";
import { type BarNotice, INFOBAR } from "../core/infobar.js";
import { connectionProblem } from "./base.js";

/**
 * Writes Neo info bar faces, which the shared key and dial writers skip: the layout once per appearance, then the
 * picture only when it changed.
 */
export class InfobarWriter {
	readonly #sent = new Map<string, string>();

	async paint<T extends JsonObject>(action: Action<T>, face: string): Promise<void> {
		if (!action.isNeoInfobar()) return;
		const last = this.#sent.get(action.id);
		if (last === face) return;
		this.#sent.set(action.id, face);
		if (last === undefined) await action.setFeedbackLayout(INFOBAR.layout);
		await action.setFeedback({ canvas: face });
	}

	/** Called before the instance (re)appears or after it goes, so its next paint sends the layout again. */
	forget(id: string): void {
		this.#sent.delete(id);
	}
}

/** The info bar's notice while its machine isn't usable, worded like the dial strips'. */
export function connectionNotice(machine: string | undefined): BarNotice | undefined {
	switch (connectionProblem(machine)) {
		case "none":
			return { glyph: "plug", title: t("notice.notFound"), detail: t("notice.openThenPress"), tone: "muted" };
		case "missing":
			return { glyph: "plug", title: t("notice.machineRemoved"), detail: t("notice.pickAnotherInSettings"), tone: "muted" };
		case "pair":
			return { glyph: "key", title: t("notice.pairDeck"), detail: t("notice.pastePairLink"), tone: "attention" };
		case "offline":
			return { glyph: "plug", title: t("notice.connecting"), detail: "", tone: "muted" };
		default:
			return undefined;
	}
}
