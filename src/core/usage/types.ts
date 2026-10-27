/**
 * The usage and limits shapes the deck reads, from T3 Code's contracts (packages/contracts/src/usage.ts and
 * providerUsageLimits.ts). T3 Code decodes their arrays with `ForwardCompatibleArray`, which drops elements it
 * doesn't know; `readUsageSummary` and `knownWindows` do the same, so totals match T3 Code's.
 */

export const USAGE_PROVIDER_KINDS = ["claude", "codex", "grok", "cursor", "opencode", "antigravity", "pi", "muse"] as const;
export type UsageProviderKind = (typeof USAGE_PROVIDER_KINDS)[number];

/** The contract version this port understands (`USAGE_CONTRACT_VERSION`), and the oldest one it can merge. */
export const USAGE_CONTRACT_VERSION = 6;
export const USAGE_MERGE_COMPATIBLE_SINCE = 4;

export type UsageResolution = "day" | "hour";

export type UsageSummaryInput = {
	sinceDay: string;
	untilDay: string;
	timeZone: string;
	resolution?: UsageResolution;
	sinceTime?: string;
	untilTime?: string;
	awaitRefresh?: boolean;
};

export type UsageTokenTotals = {
	uncachedInputTokens: number;
	cachedInputTokens: number;
	cacheCreationTokens: number;
	outputTokens: number;
	reasoningTokens: number;
};

export type UsageBucket = {
	day: string;
	hourStart?: string;
	provider: UsageProviderKind;
	model: string;
	sourcePath?: string;
	totals: UsageTokenTotals;
	costUsd: number;
	cacheSavingsUsd: number;
	categoryCostUsd?: { input: number; cacheRead: number; cacheWrite: number; output: number };
	fastCostUsd?: number;
	ultrafastCostUsd?: number;
	speedPremiumUsd?: number;
	costSource: (typeof COST_SOURCES)[number];
	records: number;
	unpricedRecords: number;
	sessions: number;
};

export type UsageSourceFingerprint = { hostId: string; provider: UsageProviderKind; resolvedHomePath: string; volumeId: string };

export const USAGE_SOURCE_STATUSES = ["ok", "missing", "partial", "failed"] as const;

export type UsageSource = {
	fingerprint: UsageSourceFingerprint;
	status: (typeof USAGE_SOURCE_STATUSES)[number];
	scannedFiles: number;
	skippedFiles: number;
	malformedRecords: number;
	distinctSessions: number;
	message: string | null;
	refreshing?: true;
};

export type UsageSummary = {
	contractVersion: number;
	readAt: string;
	timeZone: string;
	sinceDay: string;
	untilDay: string;
	buckets: readonly UsageBucket[];
	sources: readonly UsageSource[];
	pricing?: { status: string; source: string; fetchedAt: string | null; knownModels: number };
	scanDurationMs?: number;
};

const COST_SOURCES = ["providerReported", "modelPriced", "unpriced"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object";
const isProvider = (value: unknown): value is UsageProviderKind => (USAGE_PROVIDER_KINDS as readonly unknown[]).includes(value);

/** A summary with the buckets and sources this client doesn't know left out, as T3 Code's decoder leaves them. */
export function readUsageSummary(raw: unknown): UsageSummary {
	const summary = (isRecord(raw) ? raw : {}) as Partial<UsageSummary>;
	const buckets = (Array.isArray(summary.buckets) ? summary.buckets : [])
		.filter((bucket) => isRecord(bucket) && isProvider(bucket.provider) && isRecord(bucket.totals) && (COST_SOURCES as readonly unknown[]).includes(bucket.costSource))
		.map((bucket) => (typeof bucket.model === "string" && bucket.model !== bucket.model.trim() ? { ...bucket, model: bucket.model.trim() } : bucket));
	const sources = (Array.isArray(summary.sources) ? summary.sources : []).filter(
		(source) => isRecord(source) && isRecord(source.fingerprint) && isProvider(source.fingerprint.provider) && (USAGE_SOURCE_STATUSES as readonly unknown[]).includes(source.status),
	);
	return {
		contractVersion: Number(summary.contractVersion) || 0,
		readAt: String(summary.readAt ?? ""),
		timeZone: String(summary.timeZone ?? ""),
		sinceDay: String(summary.sinceDay ?? ""),
		untilDay: String(summary.untilDay ?? ""),
		buckets,
		sources,
		...(summary.pricing === undefined ? {} : { pricing: summary.pricing }),
		...(typeof summary.scanDurationMs === "number" ? { scanDurationMs: summary.scanDurationMs } : {}),
	};
}

export const USAGE_WINDOW_KINDS = ["session", "weekly", "monthly", "other"] as const;
export type UsageWindowKind = (typeof USAGE_WINDOW_KINDS)[number];

export type ServerProviderUsageWindow = {
	id: string;
	kind: UsageWindowKind;
	label: string;
	usedPercent: number;
	resetsAt?: string;
	windowDurationMins?: number;
};

export type ServerProviderResetCredits = { availableCount: number; nextExpiresAt?: string; nextCreditId?: string };

export type ServerProviderUsageLimits = {
	checkedAt: string;
	windows: ServerProviderUsageWindow[];
	credentialFingerprint?: string;
	resetCredits?: ServerProviderResetCredits;
	externalUsage?: { label: string; url: string };
	unavailable?: { reason: "unsupported" | "probeFailed"; message?: string };
};

export type UsageLimitSourceAccount = {
	id: string;
	driver: string;
	email?: string;
	plan?: string;
	workspaceId?: string;
	usageLimits: ServerProviderUsageLimits;
};

export type UsageLimitSourceSnapshot = { id: string; kind: string; label: string; checkedAt: string; accounts: UsageLimitSourceAccount[]; error?: string };

/** The `ServerProvider` fields limits read (packages/contracts/src/server.ts). */
export type LimitProvider = {
	instanceId: string;
	driver: string;
	displayName?: string;
	accentColor?: string;
	enabled?: boolean;
	installed?: boolean;
	availability?: string;
	auth?: { status?: string; email?: string; workspaceId?: string; label?: string };
	usageLimits?: ServerProviderUsageLimits;
};

/** `provider.consumeResetCredit`'s input: a native provider, or a hub account's credit. */
export type ResetCreditInput = { instanceId: string } | { sourceId: string; accountId: string; creditId: string };

export type ResetCreditOutcome = "reset" | "nothingToReset" | "noCredit" | "alreadyRedeemed";

/** Limits with windows of unknown kinds left out. */
export function knownWindows(limits: ServerProviderUsageLimits): ServerProviderUsageLimits {
	const windows = (Array.isArray(limits.windows) ? limits.windows : []).filter((window) => (USAGE_WINDOW_KINDS as readonly unknown[]).includes(window?.kind));
	return windows.length === limits.windows?.length ? limits : { ...limits, windows };
}
