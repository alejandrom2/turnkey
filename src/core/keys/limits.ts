import { failureLabel, Refusal } from "../feedback.js";
import { renderGaugeKey } from "../gauge.js";
import { t } from "../i18n.js";
import { driverMark, driverName } from "../models.js";
import { COLORS, renderInfoKey } from "../render.js";
import { limitsFace, limitsLabel } from "../ring.js";
import { grants, needsAccessLabel } from "../scopes.js";
import type { Machine } from "../t3/machine.js";
import { PROVIDERS_SCOPE } from "../t3/pairing.js";
import type { LimitPool, LimitPoolWindow } from "../usage/limits.js";
import {
	accountName,
	creditsText,
	findWindow,
	type LimitGauge,
	limitGauge,
	limitsShow,
	machineLimitPools,
	outcomeText,
	resetAction,
	resetTarget,
	resetText,
	tightestWindow,
} from "../usage/limitsView.js";
import { LimitsRefresher, refreshLimits } from "../usage/refresh.js";
import { HOLD_CONFIRM_MS } from "../approvals.js";
import type { KeyContext, KeyDefinition, KeyRuntime } from "./key.js";

/**
 * `poolSlot`: Logitech's Limit n, the provider at place n, from 1, in the order T3 Code's Limits lists them. Logitech's
 * Limits folder has none and shows the tightest window of all.
 */
export type LimitsSettings = { machine?: string; provider?: string; window?: string; show?: string; resetAction?: string; poolSlot?: number };

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The connected machines an instance following `url` (or every machine) reads from. */
export const readyOn = (runtime: Pick<KeyRuntime, "machines">, url: string | undefined): Machine[] =>
	runtime.machines().filter((machine) => (url === undefined || machine.url === url) && machine.state.kind === "ready" && machine.environmentId !== undefined);

export const poolsOn = (runtime: Pick<KeyRuntime, "machines">, url: string | undefined, now = Date.now()): readonly LimitPool[] => machineLimitPools(readyOn(runtime, url), now);

/** One for every Limits key and dial: T3 Code's throttle is per machine, not per instance. */
const refresher = new LimitsRefresher();

/**
 * Re-reads one machine's limits. Automatic refreshes keep to T3 Code's five-minute gap; a manual one shares a refresh
 * in flight, or with `after` runs again once it ends, as after spending a reset.
 */
export function refreshMachine(runtime: Pick<KeyRuntime, "repaint">, machine: Machine, automatic: boolean, after = false): Promise<void> {
	if (machine.environmentId === undefined) return Promise.resolve();
	const done = refreshLimits(refresher, machine, automatic, after);
	runtime.repaint();
	return done.finally(() => runtime.repaint());
}

const refreshing = (runtime: Pick<KeyRuntime, "machines">, url: string | undefined): boolean => readyOn(runtime, url).some((machine) => refresher.pending(machine.environmentId!));

/** A manual refresh of every machine an instance reads; resolves when all are back. */
export const refreshAll = (runtime: Pick<KeyRuntime, "machines" | "repaint">, url: string | undefined) => Promise.all(readyOn(runtime, url).map((machine) => refreshMachine(runtime, machine, false)));

/** The machine a reset for `pool` spends on, and the account; undefined when no account has one to spend. */
export function resetPlan(runtime: Pick<KeyRuntime, "machines">, pool: LimitPool) {
	const account = resetTarget(pool);
	if (account?.redeem == null) return undefined;
	const machine = readyOn(runtime, undefined).find((candidate) => candidate.environmentId === account.redeem!.environmentId);
	return machine === undefined ? undefined : { account, machine, redeem: account.redeem };
}

/**
 * A hold's reset action: open T3 Code's Usage page, or spend one banked credit on the account T3 Code would refill
 * first. Spending needs provider access on that machine; without it the machine's next pairing asks for it.
 */
export async function useReset(runtime: KeyRuntime, pool: LimitPool | undefined, settings: LimitsSettings): Promise<{ ok: boolean; label: string }> {
	if (resetAction(settings.resetAction) === "open") {
		try {
			// T3 Code has no Usage link yet; this brings the app forward, and lands on Usage once it routes one.
			await runtime.openExternal(`${runtime.scheme() ?? "t3code"}://usage`);
			return { ok: true, label: t("result.opened") };
		} catch (error) {
			runtime.warn(`Opening T3 Code failed: ${errorMessage(error)}`);
			return { ok: false, label: failureLabel(error) };
		}
	}
	const plan = pool && resetPlan(runtime, pool);
	if (plan === undefined) return { ok: false, label: t("limits.noResets") };
	if (!grants(plan.machine.scopes, PROVIDERS_SCOPE)) {
		await runtime.optIn?.request(plan.machine.url, PROVIDERS_SCOPE);
		return { ok: false, label: needsAccessLabel(PROVIDERS_SCOPE) };
	}
	try {
		const result = await plan.machine.consumeResetCredit(plan.redeem.input);
		return { ok: result.outcome === "reset", label: `${accountName(plan.account)}: ${outcomeText(result)}` };
	} catch (error) {
		runtime.warn(`Using a reset failed: ${errorMessage(error)}`);
		return { ok: false, label: failureLabel(error) };
	} finally {
		void refreshMachine(runtime, plan.machine, false, true).catch(() => undefined);
	}
}

/**
 * The gauge's two gray lines: when it resets (or that it needs a refresh), and the banked resets, or in amber that
 * spending them needs provider access the pool's machine lacks.
 */
export function gaugeLines(
	runtime: Pick<KeyRuntime, "machines" | "locale">,
	gauge: LimitGauge,
	pool: LimitPool,
	url: string | undefined,
	settings: LimitsSettings,
	now: number,
): [string, string | { text: string; color: string }] {
	const first = refreshing(runtime, url) ? t("limits.refreshing") : gauge.stale ? t("limits.pressToRefresh") : gauge.resetAt === undefined ? "" : resetText(gauge.resetAt, now, runtime.locale());
	const plan = resetAction(settings.resetAction) === "spend" ? resetPlan(runtime, pool) : undefined;
	if (plan !== undefined && !grants(plan.machine.scopes, PROVIDERS_SCOPE)) return [first, { text: t("limits.needsProviders"), color: COLORS.attention }];
	return [first, creditsText(gauge.credits)];
}

/** Logitech's limit: a pool's tightest window, used, read from every machine as the Ring always has. */
function ringLimit(ctx: KeyContext<LimitsSettings>): { percent: number; stale: boolean; driver: string; window: string } | undefined {
	const now = Date.now();
	const pools = machineLimitPools(ctx.runtime.machines(), now);
	const { poolSlot } = ctx.settings;
	const pool = poolSlot === undefined ? undefined : pools[poolSlot - 1];
	const tightest = poolSlot === undefined ? tightestWindow(pools) : pool && tightestWindow([pool]);
	if (tightest === undefined) return undefined;
	const gauge = limitGauge(tightest.pool, tightest.window, now, "used");
	return { percent: gauge.percent, stale: gauge.stale, driver: tightest.pool.driver, window: gauge.label };
}

export type LimitsState = { url: string | undefined; all: readonly LimitPool[]; pool: LimitPool | undefined; window: LimitPoolWindow | undefined };

/**
 * One provider's limit window, pooled across its accounts on the key's machine or every machine: % left (or used)
 * with a bar, the next reset and the resets banked. A tap refreshes; a hold opens T3 Code's Usage page or, when set,
 * spends a banked reset.
 */
export const limitsKey: KeyDefinition<LimitsSettings, LimitsState> = {
	state(ctx) {
		const url = ctx.machine;
		const all = poolsOn(ctx.runtime, url);
		const { provider, window } = ctx.settings;
		const pool = provider ? all.find((candidate) => candidate.driver === provider) : all[0];
		return { url, all, pool, window: pool && findWindow(pool, window) };
	},

	tile({ url, all, pool, window }, ctx) {
		const { settings } = ctx;
		if (all.length === 0) return renderInfoKey({ glyph: "gauge", title: t("limits.title"), detail: t("limits.none"), available: false });
		if (pool === undefined || window === undefined) {
			const missing = pool === undefined ? driverName(settings.provider ?? "") : (settings.window ?? "");
			return renderInfoKey({ glyph: "gauge", title: t("limits.title"), detail: t("needs.notAvailable", { value: missing }), available: false });
		}
		const now = Date.now();
		const gauge = limitGauge(pool, window, now, limitsShow(settings.show));
		return renderGaugeKey({
			mark: driverMark(pool.driver),
			label: gauge.label,
			value: `${gauge.percent}%`,
			lines: gaugeLines(ctx.runtime, gauge, pool, url, settings, now),
			fill: gauge.percent / 100,
			...(gauge.pace === undefined ? {} : { marker: gauge.pace / 100 }),
			dim: gauge.stale,
		});
	},

	glyph(_state, ctx) {
		const limit = ringLimit(ctx);
		// The folder's face has no mark: it may be any provider's.
		if (ctx.settings.poolSlot === undefined) return limitsFace(limit?.percent, limit?.stale ?? false);
		return limit ? limitsFace(limit.percent, limit.stale, limit.driver) : limitsFace(undefined, false);
	},

	label(_state, ctx) {
		const limit = ringLimit(ctx);
		return limit && limitsLabel(limit.driver, limit.window, limit.percent);
	},

	press({ url, pool }, ctx, input) {
		if (input.heldMs >= HOLD_CONFIRM_MS) {
			return {
				kind: "run",
				work: async () => {
					const result = await useReset(ctx.runtime, pool, ctx.settings);
					if (!result.ok) throw new Refusal(result.label);
				},
			};
		}
		const spends = resetAction(ctx.settings.resetAction) === "spend" && pool !== undefined && resetTarget(pool) !== undefined;
		return { kind: "run", work: () => refreshAll(ctx.runtime, url), ...(spends ? { notice: t("limits.holdToReset") } : {}) };
	},
};
