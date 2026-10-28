import { t } from "../core/i18n.js";
import type { MachineState } from "../core/t3/machine.js";
import type { SidecarMessage } from "./protocol.js";

type Status = Extract<SidecarMessage, { type: "status" }>;

/** Logi's banner for the plugin: fine once one machine is ready or connecting, else why not, with the pairing page's button. */
export function pluginStatus(states: readonly MachineState[], pairingPage: string): Status {
	const ready = states.find((state) => state.kind === "ready");
	if (ready) return { type: "status", level: "normal", message: t("logi.status.connected", { name: ready.label }) };
	if (states.some((state) => state.kind === "connecting")) return { type: "status", level: "normal", message: t("health.connecting") };
	const pair = { url: pairingPage, urlTitle: t("logi.status.pair") };
	const broken = states.find((state) => (state.kind === "error" || state.kind === "signed-out") && state.message);
	if (broken && "message" in broken && broken.message) return { type: "status", level: "error", message: broken.message, ...pair };
	return { type: "status", level: "warning", message: t("logi.status.unpaired"), ...pair };
}
