import { HOLD_CONFIRM_MS } from "../approvals.js";
import { t } from "../i18n.js";
import { spinAngle } from "../motion.js";
import { COLORS, type GlyphName, renderInfoKey } from "../render.js";
import { ringFace } from "../ring.js";
import { needsAccessLabel } from "../scopes.js";
import { type Machine, machineName } from "../t3/machine.js";
import { isThisComputer, MAINTAIN_SCOPE } from "../t3/pairing.js";
import { RpcError } from "../t3/rpc.js";
import { fetchUpdateTarget, RESTART_TIMEOUT_MS, updateFailure, updateRoute, type UpdateStage } from "../update.js";
import { accessFace, awaitingPairing, ensureScopes } from "./access.js";
import { confirmed, type KeyDefinition, type KeyRuntime } from "./key.js";

export type UpdateSettings = { machine?: string };

const STAGE_TITLE: Record<UpdateStage, Parameters<typeof t>[0]> = {
	checking: "update.checking",
	downloading: "update.downloading",
	installing: "update.installing",
	restarting: "update.restarting",
};

/** One update in flight per machine; `target` once known. `restarting` waits for the machine to come back on it. */
type UpdateRun = { stage: UpdateStage; target?: string; deadline?: number };

/** The picked machine, else T3 Code on this computer, else the only machine there is. */
export function updateMachineOf(runtime: Pick<KeyRuntime, "machines">, url: string | undefined): Machine | undefined {
	const machines = runtime.machines();
	if (url !== undefined) return machines.find((machine) => machine.url === url);
	return machines.find((machine) => isThisComputer(new URL(machine.url).hostname)) ?? (machines.length === 1 ? machines[0] : undefined);
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

export type UpdateState = { machine: Machine | undefined; run: UpdateRun | undefined; awaiting: boolean; moving: boolean };

/** A spinner while Motion allows one, else a still mark. */
function busyGlyph(runtime: Pick<KeyRuntime, "motion">, still: GlyphName): { glyph: GlyphName; spin?: number; moving: boolean } {
	const mode = runtime.motion();
	return mode === "off" ? { glyph: still, moving: false } : { glyph: "spinner", spin: spinAngle(mode, Date.now()), moving: true };
}

export type UpdateKey = KeyDefinition<UpdateSettings, UpdateState> & {
	/** Ends a restart once the machine is back on the new version, or says it didn't come back in time. */
	settle(runtime: Pick<KeyRuntime, "machines" | "repaint">): void;
	/** How an update ended without the machine coming back on a new version (up to date, failed, no return), for every key on that machine. */
	onResult(listener: (url: string, label: string) => Promise<void> | void): void;
};

/**
 * T3 Code's version on one machine. Holding it updates T3 Code there to the newest release on its channel, as its
 * Update action does; the key shows the stages, then the new version once the server is back. Needs access a standard
 * pairing doesn't ask for. Each host makes one, and its updates in flight live with it.
 */
export function createUpdateKey(): UpdateKey {
	const runs = new Map<string, UpdateRun>();
	let restartWatch: ReturnType<typeof setInterval> | undefined;
	let reportResult: (url: string, label: string) => Promise<void> | void = () => undefined;
	let staging = false;

	async function update(runtime: Pick<KeyRuntime, "machines" | "repaint" | "warn">, machine: Machine): Promise<void> {
		const route = updateRoute(machine.updateEnvironment);
		const current = machine.updateEnvironment?.serverVersion;
		const set = (run: UpdateRun | undefined) => {
			if (run === undefined) runs.delete(machine.url);
			else runs.set(machine.url, run);
			// A stage's own paint doesn't settle it: the restart shows until the next change looks again.
			staging = true;
			try {
				runtime.repaint();
			} finally {
				staging = false;
			}
		};
		set({ stage: "checking" });
		try {
			// The desktop app finds its own release; T3 Code's clients send their version, which it ignores.
			const target = route.kind === "desktop" ? undefined : current === undefined ? undefined : await fetchUpdateTarget(fetch, current);
			if (route.kind !== "desktop" && target === undefined) {
				set(undefined);
				return void (await reportResult(machine.url, t("update.upToDate")));
			}
			set({ stage: "downloading", target });
			const landing = await machine.updateServer(target ?? current ?? "0.0.0", (stage) => set({ stage, target }));
			set({ stage: "restarting", target: landing, deadline: Date.now() + RESTART_TIMEOUT_MS });
			syncWatch(runtime);
		} catch (error) {
			runtime.warn(`Updating T3 Code failed: ${errorMessage(error)}${error instanceof RpcError && error.code ? ` (${error.code})` : ""}`);
			set(undefined);
			const label = error instanceof RpcError && error.tag === "ServerSelfUpdateError" ? updateFailure(error.code) : error instanceof RpcError && error.reason ? error.reason : updateFailure(undefined);
			await reportResult(machine.url, label);
		}
	}

	/** A restart ends once the machine is back on the new version, or fails when it isn't in time. */
	function settle(runtime: Pick<KeyRuntime, "machines" | "repaint">): void {
		if (staging) return;
		for (const [url, run] of runs) {
			if (run.stage !== "restarting") continue;
			const machine = runtime.machines().find((candidate) => candidate.url === url);
			if (machine?.state.kind === "ready" && machine.updateEnvironment?.serverVersion === run.target) {
				runs.delete(url);
				runtime.repaint();
			} else if (Date.now() > (run.deadline ?? 0)) {
				runs.delete(url);
				void reportResult(url, t("update.noReturn"));
			}
		}
		syncWatch(runtime);
	}

	/** While a server restarts, look for it every few seconds instead of waiting out the reconnect backoff. */
	function syncWatch(runtime: Pick<KeyRuntime, "machines" | "repaint">): void {
		const restarting = [...runs.values()].some((run) => run.stage === "restarting");
		if (!restarting) {
			clearInterval(restartWatch);
			restartWatch = undefined;
			return;
		}
		restartWatch ??= setInterval(() => {
			for (const [url, run] of runs) {
				if (run.stage !== "restarting") continue;
				const machine = runtime.machines().find((candidate) => candidate.url === url);
				if (machine?.state.kind !== "ready") machine?.wake();
			}
			settle(runtime);
		}, 5_000);
	}

	const definition: KeyDefinition<UpdateSettings, UpdateState> = {
		state(ctx) {
			const machine = updateMachineOf(ctx.runtime, ctx.machine);
			const run = machine && runs.get(machine.url);
			return { machine, run, awaiting: machine !== undefined && awaitingPairing(ctx.runtime, machine, [MAINTAIN_SCOPE]), moving: run !== undefined && ctx.runtime.motion() !== "off" };
		},

		tile({ machine, run, awaiting }, ctx) {
			if (run !== undefined) {
				const busy = busyGlyph(ctx.runtime, "update");
				const detail = run.target ? t("update.toVersion", { version: run.target }) : machineName(machine!);
				return renderInfoKey({ glyph: busy.glyph, spin: busy.spin, title: t(STAGE_TITLE[run.stage]), detail });
			}
			if (machine === undefined) return renderInfoKey({ glyph: "update", title: t("update.title"), detail: t("update.pickMachine"), available: false });
			if (awaiting) return accessFace("update", t("update.needsAccess"));
			const environment = machine.updateEnvironment;
			const route = updateRoute(environment);
			const version = environment?.serverVersion;
			return renderInfoKey({
				glyph: "update",
				title: version ? t("update.version", { version }) : t("update.noVersion"),
				detail: route.kind === "manual" ? t(route.reason) : machineName(machine),
				available: route.kind !== "manual",
			});
		},

		// Logitech's faces stay still: a running update shows the still mark.
		glyph: ({ machine, run }) => ringFace(COLORS.accent, "update", { dim: run === undefined && (machine === undefined || updateRoute(machine.updateEnvironment).kind === "manual") }),
		label({ machine, run }) {
			if (run !== undefined) return t(STAGE_TITLE[run.stage]);
			if (machine === undefined) return t("update.pickMachine");
			const version = machine.updateEnvironment?.serverVersion;
			return version ? t("update.version", { version }) : t("update.noVersion");
		},
		available: ({ machine, run }) => run !== undefined || (machine !== undefined && updateRoute(machine.updateEnvironment).kind !== "manual"),
		moving: ({ moving }) => moving,

		press({ machine, run }, ctx, input) {
			if (machine === undefined) return { kind: "fail", label: t("update.pickMachine") };
			if (run !== undefined) return { kind: "nothing" };
			if (!ensureScopes(ctx.runtime, machine, [MAINTAIN_SCOPE])) return { kind: "fail", label: needsAccessLabel(MAINTAIN_SCOPE) };
			const route = updateRoute(machine.updateEnvironment);
			if (route.kind === "manual") return { kind: "fail", label: t(route.reason) };
			if (!confirmed(input, () => input.heldMs >= HOLD_CONFIRM_MS)) return { kind: "needsHold", label: t("update.holdToUpdate") };
			// Never throws: how it ended goes to every key on the machine, not only the one pressed.
			return { kind: "run", work: () => update(ctx.runtime, machine) };
		},
	};

	return { ...definition, settle, onResult: (listener) => void (reportResult = listener) };
}
