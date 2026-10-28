/**
 * What a Limits key or dial shows, from T3 Code's pooled limits (limits.ts): a provider's window as % left or used,
 * its next reset, the reset credits banked across its accounts, and whether the figures have gone stale.
 */
import { type MessageKey, t } from "../i18n.js";
import type { ConfigProvider } from "../models.js";
import type { Machine } from "../t3/machine.js";
import { collectLimitAccounts, collectLimitPools, displayLimitWindows, type LimitAccount, type LimitPool, type LimitPoolWindow, type LimitPresentations, limitsStale, paceRemainingPercent } from "./limits.js";
import { knownWindows, type ResetCreditOutcome, type UsageLimitSourceSnapshot } from "./types.js";

/** One environment's providers and hub accounts, as its config subscription last reported them. */
type LimitsSource = {
	environmentId: string;
	label: string;
	providers: readonly ConfigProvider[] | undefined;
	sources: readonly UsageLimitSourceSnapshot[] | undefined;
};

function limitPresentations(sources: readonly LimitsSource[]): LimitPresentations {
	return new Map(
		sources.map((source) => [
			source.environmentId,
			{
				entry: { target: { label: source.label } },
				serverConfig:
					source.providers === undefined
						? null
						: {
								providers: source.providers.map((provider) => ({
									...provider,
									driver: provider.driver ?? provider.instanceId,
									...(provider.usageLimits === undefined ? {} : { usageLimits: knownWindows(provider.usageLimits) }),
								})),
								usageLimitSources: source.sources?.map((hub) => ({ ...hub, accounts: hub.accounts.map((account) => ({ ...account, usageLimits: knownWindows(account.usageLimits) })) })),
							},
			},
		]),
	);
}

/** Every provider's pool across `sources`, as T3 Code's Limits page pools them. */
export const limitPools = (sources: readonly LimitsSource[], now: number): readonly LimitPool[] => collectLimitPools(collectLimitAccounts(limitPresentations(sources)), now);

/** Pools from every ready machine among `machines`; the rest have nothing to read yet. */
export function machineLimitPools(machines: readonly Pick<Machine, "url" | "state" | "environmentId" | "modelConfig" | "limitSources">[], now: number): readonly LimitPool[] {
	return limitPools(
		machines.flatMap((machine) =>
			machine.state.kind === "ready" && machine.environmentId !== undefined
				? [{ environmentId: machine.environmentId, label: machine.state.label, providers: machine.modelConfig?.providers, sources: machine.limitSources }]
				: [],
		),
		now,
	);
}

type LimitsShow = "left" | "used";
export const limitsShow = (value: unknown): LimitsShow => (value === "used" ? "used" : "left");

/** What a press beyond a tap does: open T3 Code's Usage page (default), or spend a banked reset from the deck. */
type ResetAction = "open" | "spend";
export const resetAction = (value: unknown): ResetAction => (value === "spend" ? "spend" : "open");

/**
 * A window setting: a pool window's id, or a kind (session, weekly, monthly) meaning the first window of that kind,
 * since Codex pools by kind and Claude by id. Empty takes the first window.
 */
export function findWindow(pool: LimitPool, setting: string | undefined): LimitPoolWindow | undefined {
	const windows = displayLimitWindows(pool);
	if (!setting) return windows[0];
	return windows.find((window) => window.id === setting) ?? windows.find((window) => window.kind === setting);
}

/** The window nearest its limit across every pool: what a Limits info bar with no provider or window set shows. */
export function tightestWindow(pools: readonly LimitPool[]): { pool: LimitPool; window: LimitPoolWindow } | undefined {
	let tightest: { pool: LimitPool; window: LimitPoolWindow } | undefined;
	for (const pool of pools) for (const window of displayLimitWindows(pool)) if (tightest === undefined || window.usedPercent > tightest.window.usedPercent) tightest = { pool, window };
	return tightest;
}

/** The window setting's choices: each window by its kind when it is the first of it, else by its id. */
export function windowChoices(pool: LimitPool): { value: string; label: string }[] {
	const seen = new Set<string>();
	return displayLimitWindows(pool).map((window) => {
		const first = window.kind !== "other" && !seen.has(window.kind);
		seen.add(window.kind);
		return { value: first ? window.kind : window.id, label: windowLabel(window) };
	});
}

const PLAIN_LABEL: Partial<Record<LimitPoolWindow["kind"], string>> = { session: "Session", weekly: "Weekly", monthly: "Monthly" };
const KIND_LABEL: Record<"weekly" | "monthly", MessageKey> = { weekly: "limits.window.weekly", monthly: "limits.window.monthly" };

/** "5-hour", "Weekly" or "Monthly" for T3 Code's plain windows; its own label ("Weekly · Opus", "Overall") otherwise. */
export function windowLabel(window: Pick<LimitPoolWindow, "kind" | "label" | "members">): string {
	if (PLAIN_LABEL[window.kind] !== window.label) return window.label;
	if (window.kind === "weekly" || window.kind === "monthly") return t(KIND_LABEL[window.kind]);
	const minutes = window.members.find((member) => member.window.windowDurationMins !== undefined)?.window.windowDurationMins;
	return minutes !== undefined && minutes > 0 && minutes % 60 === 0 ? t("limits.window.hours", { hours: minutes / 60 }) : t("limits.window.session");
}

export type LimitGauge = {
	label: string;
	/** % left or % used, as set. */
	percent: number;
	/** Where even pace would be on the same scale, when the window has a clock. */
	pace?: number;
	/** The next reset that restores something, else the first one. */
	resetAt?: number;
	/** Reset credits banked across the pool's accounts. */
	credits: number;
	stale: boolean;
	/** How many accounts the pool averages. */
	accounts: number;
};

const clampPercent = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

export function limitGauge(pool: LimitPool, window: LimitPoolWindow, now: number, show: LimitsShow): LimitGauge {
	const paces = window.members.flatMap((member) => {
		const left = paceRemainingPercent(member.window, now);
		return left === null ? [] : [left];
	});
	const paceLeft = paces.length > 0 ? paces.reduce((sum, value) => sum + value, 0) / paces.length : undefined;
	const reset = window.resets.find((entry) => entry.restoresPercent > 0) ?? window.resets[0];
	return {
		label: windowLabel(window),
		percent: clampPercent(show === "used" ? window.usedPercent : window.remainingPercent),
		...(paceLeft === undefined ? {} : { pace: clampPercent(show === "used" ? 100 - paceLeft : paceLeft) }),
		...(reset === undefined ? {} : { resetAt: reset.at }),
		credits: pool.accounts.reduce((sum, account) => sum + (account.limits.resetCredits?.availableCount ?? 0), 0),
		stale: limitsStale(pool, now),
		accounts: pool.accounts.length,
	};
}

const DAY_MS = 86_400_000;

/**
 * When a reset lands: "now", a time today ("3:05 PM"), a weekday and time within a day ("Wed 3:05 PM"), else a date
 * ("Aug 28"), in `locale` (this computer's when undefined).
 */
export function resetText(at: number, now: number, locale?: string): string {
	if (at <= now) return t("limits.resetsNow");
	const date = new Date(at);
	if (at - now >= DAY_MS) return date.toLocaleDateString(locale, { month: "short", day: "numeric" });
	const today = date.toDateString() === new Date(now).toDateString();
	return date.toLocaleString(locale, { ...(today ? {} : { weekday: "short" }), hour: "numeric", minute: "2-digit" });
}

/** "1 reset", "3 resets"; empty without any. */
export const creditsText = (count: number): string => (count <= 0 ? "" : count === 1 ? t("limits.resetOne") : t("limits.resets", { count }));

/** The account a deck press spends a credit on: the first in T3 Code's pool order (soonest refill) with one to spend. */
export const resetTarget = (pool: LimitPool): LimitAccount | undefined =>
	pool.accounts.find((account) => account.redeem !== null && (account.limits.resetCredits?.availableCount ?? 0) > 0);

/** An account as T3 Code's segments name it: email, else display name, else its plan. */
export const accountName = (account: LimitAccount): string => account.email ?? account.displayName ?? account.plan ?? account.driver;

const OUTCOME: Record<ResetCreditOutcome, MessageKey> = {
	reset: "limits.outcome.reset",
	nothingToReset: "limits.outcome.nothingToReset",
	noCredit: "limits.outcome.noCredit",
	alreadyRedeemed: "limits.outcome.alreadyRedeemed",
};

/** What spending a credit did, in T3 Code's words when it sent a warning. */
export const outcomeText = (result: { outcome: ResetCreditOutcome; warning?: string }): string => result.warning ?? t(OUTCOME[result.outcome] ?? "result.done");

/** A pool window on a dial, kept by its provider and window so it stays put as figures change. */
export type LimitTile = { key: string; pool: LimitPool; window: LimitPoolWindow };

export const limitTiles = (pools: readonly LimitPool[]): LimitTile[] =>
	pools.flatMap((pool) => displayLimitWindows(pool).map((window) => ({ key: `${pool.driver}|${window.id}`, pool, window })));
