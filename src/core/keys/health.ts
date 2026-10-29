import { type HealthMachine, summarizeHealth } from "../health.js";
import { t } from "../i18n.js";
import { COLORS, renderInfoKey } from "../render.js";
import { ringFace } from "../ring.js";
import { type Machine, machineName } from "../t3/machine.js";
import type { KeyDefinition } from "./key.js";

/** A machine as Health weighs it: its connection, and its providers once connected. */
export const healthMachine = (machine: Machine): HealthMachine => ({
	name: machineName(machine),
	state: machine.state.kind,
	canOperate: machine.canOperate,
	message: machine.state.kind === "error" ? machine.state.message : undefined,
	providers: machine.modelConfig?.providers,
});

const HEALTH_COLOR = { error: COLORS.error, attention: COLORS.attention, note: COLORS.done, ok: COLORS.done, connecting: COLORS.muted } as const;

export type HealthState =
	| { kind: "none"; url: string | undefined }
	| { kind: "summary"; url: string | undefined; title: string; detail: string | undefined; color: string; loud: boolean; pairing: boolean };

/**
 * The connections to the key's machine (or all of them) and their providers: the worst problem first (offline, needs
 * pairing, a provider not found, not authenticated, on an unsupported version or unavailable), how many more, else
 * that all is ready. A press reconnects.
 */
export const healthKey: KeyDefinition<object, HealthState> = {
	state(ctx) {
		const url = ctx.machine;
		const machines = ctx.runtime.machines().filter((machine) => url === undefined || machine.url === url);
		if (machines.length === 0) return { kind: "none", url };
		const summary = summarizeHealth(machines.map(healthMachine));
		const color = HEALTH_COLOR[summary.level];
		return {
			kind: "summary",
			url,
			title: summary.title,
			detail: summary.detail,
			color,
			loud: summary.level === "error" || summary.level === "attention",
			pairing: machines.length === 1 && machines[0]!.state.kind === "signed-out",
		};
	},

	tile(state) {
		if (state.kind === "none") {
			const { url } = state;
			const title = url === undefined ? t("notice.notFound") : t("notice.machineRemoved");
			return renderInfoKey({ glyph: "plug", title, detail: url === undefined ? t("notice.openThenPress") : t("notice.pickAnother"), available: false });
		}
		const { color, loud, pairing, title, detail } = state;
		return renderInfoKey({ glyph: pairing ? "key" : "health", color, tint: loud ? color : undefined, title, detail });
	},

	glyph: (state) => (state.kind === "none" ? ringFace(COLORS.muted, "plug", { dim: true }) : ringFace(state.color, state.pairing ? "key" : "health")),
	label: (state) => (state.kind === "none" ? t("notice.notFound") : [state.title, state.detail].filter(Boolean).join(" · ")),

	press: ({ url }, ctx) => ({ kind: "run", work: () => ctx.runtime.retry(url) }),

	// Provider statuses stay live only while a Health key shows them.
	watch: { open: (machine) => machine.watchConfig() },
};
