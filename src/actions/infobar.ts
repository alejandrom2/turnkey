import { t } from "../core/i18n.js";
import type { BarNotice } from "../core/infobar.js";
import { connectionProblem } from "./base.js";

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
