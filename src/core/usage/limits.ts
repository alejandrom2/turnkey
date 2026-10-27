/**
 * Ported from T3 Code's packages/shared/src/usageLimits.ts: subscription limits pooled per provider across every
 * environment and hub account, as T3 Code's Usage → Limits page shows them. Accounts that are the same login count
 * once; each pool window averages its accounts and orders its resets. `limitsExpireAt` is the staleness rule of T3
 * Code's mobile widget (apps/mobile/src/widgets/subscriptionUsageSnapshot.ts). The slash command, notices and
 * external links are left out; the deck draws its own words.
 */
import type { LimitProvider, ResetCreditInput, ServerProviderUsageLimits, ServerProviderUsageWindow, UsageLimitSourceSnapshot } from "./types.js";

type EnvironmentId = string;

/** Cursor's windows in T3 Code's order (`CURSOR_USAGE_WINDOWS`). */
const CURSOR_USAGE_WINDOWS = [{ id: "totalPercentUsed" }, { id: "autoPercentUsed" }, { id: "apiPercentUsed" }] as const;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function cursorUsageWindowRank(id: string): number {
	const rank = CURSOR_USAGE_WINDOWS.findIndex((window) => window.id === id);
	return rank < 0 ? CURSOR_USAGE_WINDOWS.length : rank;
}

function providersWithLimits(providers: readonly LimitProvider[]): readonly LimitProvider[] {
	return providers.filter(
		(provider) =>
			provider.enabled &&
			provider.installed &&
			provider.availability !== "unavailable" &&
			provider.usageLimits !== undefined,
	);
}

export type LimitPresentations = ReadonlyMap<
	EnvironmentId,
	{
		readonly entry: { readonly target: { readonly label: string } };
		readonly serverConfig: {
			readonly providers: readonly LimitProvider[];
			readonly usageLimitSources?: readonly UsageLimitSourceSnapshot[] | undefined;
		} | null;
	}
>;

function accountKey(
	driver: string,
	email: string | undefined,
	limits?: ServerProviderUsageLimits,
): string | null {
	const normalizedEmail = email?.trim().toLowerCase();
	if (normalizedEmail) return `${driver}:${normalizedEmail}`;
	return limits?.credentialFingerprint
		? `${driver}:credential:${limits.credentialFingerprint}`
		: null;
}

interface AccountReport {
	readonly driver: string;
	readonly email?: string | undefined;
	readonly workspaceId?: string | undefined;
	readonly usageLimits?: ServerProviderUsageLimits | undefined;
}

const nativeReport = (provider: LimitProvider): AccountReport => ({
	driver: provider.driver,
	email: provider.auth?.email,
	workspaceId: provider.auth?.workspaceId,
	usageLimits: provider.usageLimits,
});

// Include every enabled login, even unreadable workspaces.
function accountKeyResolver(reports: Iterable<AccountReport>) {
	const workspaces = new Map<string, Set<string>>();
	for (const report of reports) {
		const key = accountKey(report.driver, report.email, report.usageLimits);
		if (key && report.workspaceId) {
			workspaces.set(key, (workspaces.get(key) ?? new Set()).add(report.workspaceId));
		}
	}
	return (report: AccountReport): string | null => {
		const key = accountKey(report.driver, report.email, report.usageLimits);
		if (!key) return null;
		if (report.workspaceId) return `${key}:${report.workspaceId}`;
		const known = workspaces.get(key);
		if (!known) return key;
		return known.size === 1 ? `${key}:${[...known][0]}` : null;
	};
}

export interface LimitAccount {
	readonly key: string;
	readonly driver: string;
	readonly displayName: string | null;
	readonly email: string | undefined;
	readonly plan: string | undefined;
	readonly accentColor: string | undefined;
	readonly environments: ReadonlyArray<{
		readonly environmentId: EnvironmentId;
		readonly label: string;
	}>;
	readonly sourceLabel: string | null;
	readonly redeem: {
		readonly environmentId: EnvironmentId;
		readonly input: ResetCreditInput;
	} | null;
	readonly limits: ServerProviderUsageLimits;
}

export function collectLimitAccounts(presentations: LimitPresentations): readonly LimitAccount[] {
	const accounts = new Map<string, LimitAccount>();
	const creditSources = new Map<string, LimitAccount>();
	const hubRedeems = new Map<string, LimitAccount>();
	const merge = (key: string, next: LimitAccount) => {
		// Prefer hub redemption to clear its routing cooldown too; displayed balance still follows the freshest read.
		const previousHub = hubRedeems.get(key);
		if (
			next.redeem &&
			"sourceId" in next.redeem.input &&
			(!previousHub || Date.parse(next.limits.checkedAt) > Date.parse(previousHub.limits.checkedAt))
		) {
			hubRedeems.set(key, next);
		}
		const previousCredit = creditSources.get(key);
		if (
			next.limits.resetCredits &&
			(!previousCredit ||
				Date.parse(next.limits.checkedAt) > Date.parse(previousCredit.limits.checkedAt))
		) {
			creditSources.set(key, next);
		}
		const previous = accounts.get(key);
		if (!previous) {
			accounts.set(key, next);
			return;
		}
		const fresher = Date.parse(next.limits.checkedAt) > Date.parse(previous.limits.checkedAt);
		const environments = [
			...previous.environments,
			...next.environments.filter(
				(candidate) =>
					!previous.environments.some((seen) => seen.environmentId === candidate.environmentId),
			),
		];
		const winner = fresher ? next : previous;
		const creditSource = creditSources.get(key);
		accounts.set(key, {
			...previous,
			displayName: previous.displayName ?? next.displayName,
			plan: previous.plan ?? next.plan,
			accentColor: previous.accentColor ?? next.accentColor,
			environments,
			sourceLabel: environments.length > 0 ? null : (previous.sourceLabel ?? next.sourceLabel),
			redeem:
				hubRedeems.get(key)?.redeem ??
				(creditSource ? creditSource.redeem : (winner.redeem ?? previous.redeem ?? next.redeem)),
			limits: {
				...winner.limits,
				...(creditSource?.limits.resetCredits
					? { resetCredits: creditSource.limits.resetCredits }
					: { resetCredits: undefined }),
			},
		});
	};
	const resolveKey = accountKeyResolver(
		[...presentations.values()].flatMap((presentation) => [
			...(presentation.serverConfig?.providers ?? [])
				.filter((provider) => provider.enabled)
				.map(nativeReport),
			...(presentation.serverConfig?.usageLimitSources ?? []).flatMap((source) => source.accounts),
		]),
	);
	for (const [environmentId, presentation] of presentations) {
		const label = presentation.entry.target.label;
		for (const provider of providersWithLimits(presentation.serverConfig?.providers ?? [])) {
			if (!provider.usageLimits || limitsNotice(provider.usageLimits) !== null) continue;
			merge(resolveKey(nativeReport(provider)) ?? `${environmentId}:${provider.instanceId}`, {
				key: `${environmentId}:${provider.instanceId}`,
				driver: provider.driver,
				displayName: provider.displayName?.trim() || null,
				email: provider.auth?.email,
				plan: provider.auth?.label,
				accentColor: provider.accentColor,
				environments: [{ environmentId, label }],
				sourceLabel: null,
				redeem: { environmentId, input: { instanceId: provider.instanceId } },
				limits: provider.usageLimits,
			});
		}
	}
	const labelEnvironment = presentations.size > 1;
	for (const [environmentId, presentation] of presentations) {
		for (const source of presentation.serverConfig?.usageLimitSources ?? []) {
			const sourceLabel = labelEnvironment
				? `${presentation.entry.target.label} · ${source.label}`
				: source.label;
			for (const account of source.accounts) {
				if (limitsNotice(account.usageLimits) !== null) continue;
				const key = `${source.id}:${account.id}${account.workspaceId ? `:${account.workspaceId}` : ""}`;
				merge(resolveKey(account) ?? key, {
					key,
					driver: account.driver,
					displayName: account.email ? null : account.id.replace(/\.json$/i, ""),
					email: account.email,
					plan: account.plan,
					accentColor: undefined,
					environments: [],
					sourceLabel,
					redeem: account.usageLimits.resetCredits?.nextCreditId
						? {
								environmentId,
								input: {
									sourceId: source.id,
									accountId: account.id,
									creditId: account.usageLimits.resetCredits.nextCreditId,
								},
							}
						: null,
					limits: account.usageLimits,
				});
			}
		}
	}
	return [...accounts.values()];
}

export interface LimitPoolMember {
	readonly account: LimitAccount;
	readonly window: ServerProviderUsageWindow;
	readonly refillPercent: number;
}

export interface LimitPoolWindow {
	readonly id: string;
	readonly kind: ServerProviderUsageWindow["kind"];
	readonly label: string;
	readonly members: readonly LimitPoolMember[];
	readonly columns: ReadonlyArray<
		LimitPoolMember | { readonly account: LimitAccount; readonly window: null }
	>;
	readonly remainingPercent: number;
	readonly usedPercent: number;
	readonly pace: LimitPace | null;
	readonly resets: ReadonlyArray<{
		readonly member: LimitPoolMember;
		readonly at: number;
		readonly restoresPercent: number;
	}>;
}

export interface LimitPool {
	readonly driver: string;
	readonly accounts: readonly LimitAccount[];
	readonly windows: readonly LimitPoolWindow[];
}

export function displayLimitWindows(pool: LimitPool) {
	if (pool.driver === "antigravity") {
		return [...pool.windows].sort(
			(left, right) =>
				Number(!left.id.startsWith("gemini-")) - Number(!right.id.startsWith("gemini-")) ||
				left.id
					.replace(/-(5h|weekly|quota)$/, "")
					.localeCompare(right.id.replace(/-(5h|weekly|quota)$/, "")) ||
				WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind],
		);
	}
	if (pool.driver !== "cursor") return pool.windows;
	const hasAuto = pool.windows.some((window) => window.id === "autoPercentUsed");
	const hasApi = pool.windows.some((window) => window.id === "apiPercentUsed");
	const hasBothPools = hasAuto && hasApi;
	return pool.windows
		.filter((window) => !hasBothPools || window.id !== "totalPercentUsed")
		.sort((left, right) => cursorUsageWindowRank(left.id) - cursorUsageWindowRank(right.id));
}

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
	session: 0,
	weekly: 1,
	monthly: 2,
	other: 3,
};

export function collectLimitPools(
	accounts: readonly LimitAccount[],
	now: number,
): readonly LimitPool[] {
	const byDriver = new Map<string, LimitAccount[]>();
	for (const account of accounts) {
		const list = byDriver.get(account.driver);
		if (list) list.push(account);
		else byDriver.set(account.driver, [account]);
	}
	return [...byDriver].map(([driver, members]) => {
		const orderWindow = members
			.flatMap((account) => account.limits.windows)
			.sort((left, right) => WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind])[0];
		const orderReset = (account: LimitAccount) => {
			const window = account.limits.windows.find(
				(window) => orderWindow && poolKey(driver, window) === poolKey(driver, orderWindow),
			);
			return (
				(window ? resetMillis(poolMember(account, window, now).window) : null) ??
				Number.POSITIVE_INFINITY
			);
		};
		const sorted = [...members].sort(
			(left, right) =>
				orderReset(left) - orderReset(right) ||
				accountSortName(left).localeCompare(accountSortName(right)) ||
				left.key.localeCompare(right.key),
		);
		return { driver, accounts: sorted, windows: poolWindows(sorted, now) };
	});
}

function accountSortName(account: LimitAccount): string {
	return (account.displayName ?? account.email ?? account.key).toLowerCase();
}

// Codex ids name slots, so pool by kind; other drivers' ids identify distinct allowances.
function poolKey(driver: string, window: ServerProviderUsageWindow): string {
	return driver === "codex" ? window.kind : `${window.kind}:${window.id}`;
}

function poolMember(account: LimitAccount, reported: ServerProviderUsageWindow, now: number) {
	const spentWeekly =
		reported.kind === "session"
			? account.limits.windows.find(
					(window) =>
						window.usedPercent >= 100 &&
						(account.driver === "claudeAgent"
							? window.id === "seven_day"
							: account.driver === "codex" && window.kind === "weekly"),
				)
			: undefined;
	if (!spentWeekly) return { account, window: reported, refillPercent: reported.usedPercent };

	const weeklyReset = resetMillis(spentWeekly);
	const sessionReset = resetMillis(reported);
	const cutoff = Math.max(now, Date.parse(account.limits.checkedAt));
	let resetsAt: string | undefined;
	let refillPercent = 0;
	// A stale or missing clock cannot tell us when blocked quota becomes usable.
	if (
		weeklyReset !== null &&
		sessionReset !== null &&
		weeklyReset > cutoff &&
		sessionReset > cutoff
	) {
		if (sessionReset <= weeklyReset) {
			resetsAt = spentWeekly.resetsAt;
			refillPercent = 100;
		} else if (reported.usedPercent >= 100) {
			resetsAt = reported.resetsAt;
			refillPercent = 100;
		} else {
			resetsAt = spentWeekly.resetsAt;
			refillPercent = 100 - Math.max(0, Math.min(100, reported.usedPercent));
		}
	}
	return {
		account,
		// Suppression is not session spending, so it has no session pace clock.
		window: { ...reported, usedPercent: 100, resetsAt, windowDurationMins: undefined },
		refillPercent,
	};
}

function poolWindows(accounts: readonly LimitAccount[], now: number): readonly LimitPoolWindow[] {
	const byKey = new Map<string, LimitPoolMember[]>();
	for (const account of accounts) {
		for (const reported of account.limits.windows) {
			const member = poolMember(account, reported, now);
			const { window } = member;
			const pooled = poolKey(account.driver, window);
			const key = byKey.get(pooled)?.some((member) => member.account === account)
				? `${window.kind}:${window.id}`
				: pooled;
			const list = byKey.get(key);
			if (list) list.push(member);
			else byKey.set(key, [member]);
		}
	}
	const pools = [...byKey].map(([key, members]): LimitPoolWindow => {
		const memberByAccount = new Map(members.map((member) => [member.account.key, member]));
		const first = members[0]!.window;
		const id = members[0]!.account.driver === "codex" ? key : first.id;
		const usedPercent = members.reduce((sum, m) => sum + m.window.usedPercent, 0) / members.length;
		// Judge pace only for windows with reset clocks; others add spend without elapsed time.
		const timed = members.flatMap((m) => {
			const share = elapsedShare(m.window, now);
			return share === null ? [] : [{ used: m.window.usedPercent, elapsed: share }];
		});
		const timedUsed = timed.reduce((sum, t) => sum + t.used, 0) / timed.length;
		const meanElapsed =
			timed.length > 0 ? timed.reduce((sum, t) => sum + t.elapsed, 0) / timed.length : null;
		const resets = members
			.flatMap((member) => {
				const at = resetMillis(member.window);
				return at === null
					? []
					: [
							{
								member,
								at,
								restoresPercent: Math.round(member.refillPercent / members.length),
							},
						];
			})
			.sort((left, right) => left.at - right.at);
		return {
			id,
			kind: first.kind,
			label: first.label,
			members,
			columns: accounts.map(
				(account) => memberByAccount.get(account.key) ?? { account, window: null },
			),
			usedPercent: Math.round(usedPercent),
			remainingPercent: Math.round(100 - usedPercent),
			pace: meanElapsed === null ? null : paceOfShares(timedUsed, meanElapsed),
			resets,
		};
	});
	return pools.sort((left, right) => WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind]);
}

/** Why an account shows no limits, or null when it does; T3 Code returns its sentence, the deck the reason. */
export function limitsNotice(limits: ServerProviderUsageLimits): "unsupported" | "probeFailed" | "empty" | null {
	if (limits.unavailable?.reason === "unsupported") return "unsupported";
	if (limits.unavailable?.reason === "probeFailed") return "probeFailed";
	return limits.windows.length === 0 ? "empty" : null;
}

export function remainingPercent(window: ServerProviderUsageWindow): number {
	return Math.round(100 - Math.max(0, Math.min(100, window.usedPercent)));
}

function resetMillis(window: ServerProviderUsageWindow): number | null {
	if (window.resetsAt === undefined) return null;
	const at = Date.parse(window.resetsAt);
	return Number.isFinite(at) ? at : null;
}

export function elapsedShare(window: ServerProviderUsageWindow, now: number): number | null {
	const resetsAt = resetMillis(window);
	if (resetsAt === null || window.windowDurationMins === undefined) return null;
	const length = window.windowDurationMins * MINUTE;
	if (length <= 0) return null;
	return Math.max(0, Math.min(1, (length - (resetsAt - now)) / length));
}

// Bars show quota remaining, so even pace tracks time remaining.
export function paceRemainingPercent(
	window: ServerProviderUsageWindow,
	now: number,
): number | null {
	const elapsed = elapsedShare(window, now);
	return elapsed === null ? null : Math.round((1 - elapsed) * 100);
}

export type LimitPace = "ahead" | "on" | "under";

export function paceOf(window: ServerProviderUsageWindow, now: number): LimitPace | null {
	const elapsed = elapsedShare(window, now);
	return elapsed === null ? null : paceOfShares(window.usedPercent, elapsed);
}

function paceOfShares(usedPercent: number, elapsed: number): LimitPace {
	const gap = usedPercent - elapsed * 100;
	if (gap > 5) return "ahead";
	if (gap < -5) return "under";
	return "on";
}

export function formatDuration(ms: number): string {
	const remaining = Math.max(0, ms);
	const days = Math.floor(remaining / DAY);
	const hours = Math.floor((remaining % DAY) / HOUR);
	const minutes = Math.floor((remaining % HOUR) / MINUTE);
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

/** Snapshots expire after 15 minutes, as the widget's do. */
const SNAPSHOT_MAX_AGE = 15 * MINUTE;

/** When a pool's figures stop being trustworthy: 15 minutes after its oldest read, or at its first reset. */
export function limitsExpireAt(pool: LimitPool): number {
	const checkedAt = Math.min(...pool.accounts.map((account) => Date.parse(account.limits.checkedAt)));
	return Math.min(checkedAt + SNAPSHOT_MAX_AGE, ...pool.windows.flatMap((window) => window.resets.map((reset) => reset.at)));
}

/** The widget's rule: stale once `limitsExpireAt` has passed, or when it can't be told. */
export function limitsStale(pool: LimitPool, now: number): boolean {
	const expiresAt = limitsExpireAt(pool);
	return !(Number.isFinite(expiresAt) && expiresAt > now);
}
