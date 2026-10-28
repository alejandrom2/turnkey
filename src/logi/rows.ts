import { t } from "../core/i18n.js";
import type { Machine } from "../core/t3/machine.js";
import { isLoopbackUrl } from "../core/t3/pairing.js";
import type { MachineRow } from "./page.js";

/** The machines page's rows, named as their pairing knew them, this computer's as "This machine" until it pairs. */
export function machineRows(machines: readonly Pick<Machine, "url" | "state">[], storedLabel: (url: string) => string | undefined): MachineRow[] {
	return machines.map(({ url, state }) => {
		const label = state.kind === "ready" ? state.label : (storedLabel(url) ?? (isLoopbackUrl(url) ? t("machine.thisMachine") : new URL(url).host));
		const row = { url, label };
		switch (state.kind) {
			case "ready":
				return { ...row, state: "connected" };
			case "connecting":
				return { ...row, state: "connecting" };
			case "signed-out":
				return state.message ? { ...row, state: "problem", detail: state.message } : { ...row, state: "needsPairing" };
			case "error":
				return { ...row, state: "problem", detail: state.message };
		}
	});
}
