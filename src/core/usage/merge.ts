/**
 * Ported from T3 Code's packages/shared/src/usageMerge.ts: merges each environment's usage summary the way T3 Code's
 * Usage page does, so a history directory two environments both scan counts once and session totals stay right.
 * The model detail figures at the end come from apps/web/src/components/usage/usageBreakdown.ts.
 */
import {
	type UsageBucket,
	type UsageProviderKind,
	type UsageSource,
	type UsageSourceFingerprint,
	type UsageSummary,
	type UsageTokenTotals,
	USAGE_MERGE_COMPATIBLE_SINCE,
} from "./types.js";

type EnvironmentId = string;

export interface EnvironmentUsage {
	readonly environmentId: EnvironmentId;
	readonly summary: UsageSummary;
}

interface ProviderTotals {
	readonly provider: UsageProviderKind;
	readonly costUsd: number;
	readonly totalTokens: number;
	readonly sessions: number;
}

type InputTokens = Pick<UsageTokenTotals, "uncachedInputTokens" | "cachedInputTokens" | "cacheCreationTokens">;

interface ModelTotals {
	readonly model: string;
	readonly provider: UsageProviderKind;
	readonly costUsd: number;
	readonly totalTokens: number;
	readonly tokens: InputTokens;
	readonly records: number;
	readonly unpricedRecords: number;
	readonly unpricedTokens: number;
	readonly costShare: number;
}

/** When every record lacks rates, costUsd is unknown and must not be displayed as a dollar figure. */
export function isModelCostUnknown(model: ModelTotals): boolean {
	return model.records > 0 && model.unpricedRecords >= model.records;
}

interface UsageContractMismatch {
	readonly direction: "serverBehind" | "clientBehind";
}

export interface MergedUsage {
	readonly costUsd: number;
	readonly totalTokens: number;
	readonly sessions: number;
	readonly providers: readonly ProviderTotals[];
	readonly models: readonly ModelTotals[];
	readonly contractMismatches: readonly UsageContractMismatch[];
}

// volumeId distinguishes machines sharing a hostname and home path.
function fingerprintKey(fingerprint: UsageSourceFingerprint): string {
	return [
		fingerprint.hostId,
		fingerprint.provider,
		fingerprint.resolvedHomePath,
		fingerprint.volumeId,
	].join(" ");
}

function bucketsForSource(summary: UsageSummary, source: UsageSource): readonly UsageBucket[] {
	const providerSources = summary.sources.filter(
		(entry) => entry.fingerprint.provider === source.fingerprint.provider,
	);
	return summary.buckets.filter(
		(bucket) =>
			bucket.provider === source.fingerprint.provider &&
			(bucket.sourcePath === source.fingerprint.resolvedHomePath ||
				(bucket.sourcePath === undefined && providerSources.length === 1)),
	);
}

function bucketKey(bucket: UsageBucket): string {
	return JSON.stringify([bucket.day, bucket.hourStart ?? null, bucket.provider, bucket.model]);
}

function claimSources(environments: readonly EnvironmentUsage[]): {
	readonly ownerByFingerprint: ReadonlyMap<string, EnvironmentId>;
	readonly supplementalBucketsByEnvironment: ReadonlyMap<EnvironmentId, ReadonlySet<UsageBucket>>;
	readonly sessionsByFingerprint: ReadonlyMap<string, number>;
} {
	const ownerByFingerprint = new Map<string, EnvironmentId>();
	const ownerScanByFingerprint = new Map<
		string,
		{ environment: EnvironmentUsage; source: UsageSource }
	>();
	const seenBucketKeysByFingerprint = new Map<string, Set<string>>();
	const supplementalBucketsByEnvironment = new Map<EnvironmentId, Set<UsageBucket>>();
	const sessionsByFingerprint = new Map<string, number>();

	const ordered = [...environments].sort(
		(a, b) =>
			(Date.parse(b.summary.readAt) || 0) - (Date.parse(a.summary.readAt) || 0) ||
			a.environmentId.localeCompare(b.environmentId),
	);

	for (const status of ["ok", "partial", "failed"] as const) {
		for (const environment of ordered) {
			for (const source of environment.summary.sources) {
				if (source.status !== status) continue;
				const key = fingerprintKey(source.fingerprint);
				if (ownerByFingerprint.has(key)) continue;
				ownerByFingerprint.set(key, environment.environmentId);
				ownerScanByFingerprint.set(key, { environment, source });
				sessionsByFingerprint.set(key, source.distinctSessions);
			}
		}
	}

	// Keep cells unique to newer partial scans; aggregates cannot reconcile overlapping records without double-counting.
	for (const environment of ordered) {
		for (const source of environment.summary.sources) {
			if (source.status !== "partial") continue;
			const key = fingerprintKey(source.fingerprint);
			const owner = ownerScanByFingerprint.get(key);
			if (
				owner?.source.status !== "ok" ||
				Date.parse(environment.summary.readAt) <= Date.parse(owner.environment.summary.readAt)
			) {
				continue;
			}
			let seen = seenBucketKeysByFingerprint.get(key);
			if (seen === undefined) {
				seen = new Set(bucketsForSource(owner.environment.summary, owner.source).map(bucketKey));
				seenBucketKeysByFingerprint.set(key, seen);
			}
			const supplemental =
				supplementalBucketsByEnvironment.get(environment.environmentId) ?? new Set<UsageBucket>();
			let added = false;
			for (const bucket of bucketsForSource(environment.summary, source)) {
				const cell = bucketKey(bucket);
				if (seen.has(cell)) continue;
				seen.add(cell);
				supplemental.add(bucket);
				added = true;
			}
			if (!added) continue;
			supplementalBucketsByEnvironment.set(environment.environmentId, supplemental);
			sessionsByFingerprint.set(
				key,
				Math.max(sessionsByFingerprint.get(key) ?? 0, source.distinctSessions),
			);
		}
	}

	return {
		ownerByFingerprint,
		supplementalBucketsByEnvironment,
		sessionsByFingerprint,
	};
}

function ownedContribution(
	environment: EnvironmentUsage,
	ownerByFingerprint: ReadonlyMap<string, EnvironmentId>,
	supplementalBuckets: ReadonlySet<UsageBucket>,
	sessionsByFingerprint: ReadonlyMap<string, number>,
): {
	readonly buckets: readonly UsageBucket[];
	readonly sessionsByProvider: ReadonlyMap<UsageProviderKind, number>;
} {
	const ownedProviders = new Set<UsageProviderKind>();
	const ownedSources = new Set<string>();
	const sessionsByProvider = new Map<UsageProviderKind, number>();
	for (const source of environment.summary.sources) {
		if (source.status === "missing") continue;
		const key = fingerprintKey(source.fingerprint);
		if (ownerByFingerprint.get(key) === environment.environmentId) {
			const provider = source.fingerprint.provider;
			ownedProviders.add(provider);
			ownedSources.add(`${provider}\u0000${source.fingerprint.resolvedHomePath}`);
			// Count distinct sessions per directory; bucket sums overcount sessions spanning days/models.
			sessionsByProvider.set(
				provider,
				(sessionsByProvider.get(provider) ?? 0) +
					(sessionsByFingerprint.get(key) ?? source.distinctSessions),
			);
		}
	}
	return {
		buckets: environment.summary.buckets.filter(
			(bucket) =>
				supplementalBuckets.has(bucket) ||
				(bucket.sourcePath === undefined
					? ownedProviders.has(bucket.provider)
					: ownedSources.has(`${bucket.provider}\u0000${bucket.sourcePath}`)),
		),
		sessionsByProvider,
	};
}

function bucketTokens(bucket: UsageBucket): number {
	// reasoningTokens is a subset of outputTokens and must not be added again.
	return (
		bucket.totals.uncachedInputTokens +
		bucket.totals.cachedInputTokens +
		bucket.totals.cacheCreationTokens +
		bucket.totals.outputTokens
	);
}

function isCompatibleUsageContractVersion(version: number, expected: number): boolean {
	return version >= USAGE_MERGE_COMPATIBLE_SINCE && version <= expected;
}

const EMPTY_MERGED: MergedUsage = {
	costUsd: 0,
	totalTokens: 0,
	sessions: 0,
	providers: [],
	models: [],
	contractMismatches: [],
};

export function mergeUsage(
	environments: readonly EnvironmentUsage[],
	expectedContractVersion: number,
): MergedUsage {
	if (environments.length === 0) return EMPTY_MERGED;

	const current: EnvironmentUsage[] = [];
	const contractMismatches: UsageContractMismatch[] = [];
	for (const environment of environments) {
		if (
			isCompatibleUsageContractVersion(environment.summary.contractVersion, expectedContractVersion)
		) {
			current.push(environment);
		} else {
			contractMismatches.push({
				direction:
					environment.summary.contractVersion < expectedContractVersion
						? "serverBehind"
						: "clientBehind",
			});
		}
	}

	const {
		ownerByFingerprint,
		supplementalBucketsByEnvironment,
		sessionsByFingerprint,
	} = claimSources(current);

	let costUsd = 0;
	let totalTokens = 0;
	let sessions = 0;

	const providerAccumulator = new Map<
		UsageProviderKind,
		{ costUsd: number; totalTokens: number; sessions: number }
	>();
	const modelAccumulator = new Map<
		string,
		{
			provider: UsageProviderKind;
			costUsd: number;
			totalTokens: number;
			tokens: InputTokens;
			records: number;
			unpricedRecords: number;
			unpricedTokens: number;
		}
	>();

	for (const environment of current) {
		const { buckets, sessionsByProvider } = ownedContribution(
			environment,
			ownerByFingerprint,
			supplementalBucketsByEnvironment.get(environment.environmentId) ?? new Set(),
			sessionsByFingerprint,
		);

		for (const [providerKind, providerSessions] of sessionsByProvider) {
			sessions += providerSessions;
			if (providerSessions === 0) continue;
			const provider = providerAccumulator.get(providerKind) ?? {
				costUsd: 0,
				totalTokens: 0,
				sessions: 0,
			};
			provider.sessions += providerSessions;
			providerAccumulator.set(providerKind, provider);
		}

		for (const bucket of buckets) {
			const tokens = bucketTokens(bucket);

			costUsd += bucket.costUsd;
			totalTokens += tokens;

			const provider = providerAccumulator.get(bucket.provider) ?? {
				costUsd: 0,
				totalTokens: 0,
				sessions: 0,
			};
			provider.costUsd += bucket.costUsd;
			provider.totalTokens += tokens;
			providerAccumulator.set(bucket.provider, provider);

			const modelKey = `${bucket.provider} ${bucket.model}`;
			const model = modelAccumulator.get(modelKey) ?? {
				provider: bucket.provider,
				costUsd: 0,
				totalTokens: 0,
				tokens: {
					uncachedInputTokens: 0,
					cachedInputTokens: 0,
					cacheCreationTokens: 0,
				},
				records: 0,
				unpricedRecords: 0,
				unpricedTokens: 0,
			};
			model.costUsd += bucket.costUsd;
			model.totalTokens += tokens;
			model.tokens = {
				uncachedInputTokens: model.tokens.uncachedInputTokens + bucket.totals.uncachedInputTokens,
				cachedInputTokens: model.tokens.cachedInputTokens + bucket.totals.cachedInputTokens,
				cacheCreationTokens: model.tokens.cacheCreationTokens + bucket.totals.cacheCreationTokens,
			};
			model.records += bucket.records;
			model.unpricedRecords += bucket.unpricedRecords;
			if (bucket.records > 0) {
				model.unpricedTokens += (tokens * bucket.unpricedRecords) / bucket.records;
			}
			modelAccumulator.set(modelKey, model);
		}
	}

	const providers: ProviderTotals[] = [...providerAccumulator.entries()]
		.map(([provider, totals]) => ({
			provider,
			costUsd: totals.costUsd,
			totalTokens: totals.totalTokens,
			sessions: totals.sessions,
		}))
		.sort((a, b) => b.costUsd - a.costUsd);

	const models: ModelTotals[] = [...modelAccumulator.entries()]
		.map(([key, totals]) => ({
			model: key.slice(key.indexOf(" ") + 1),
			provider: totals.provider,
			costUsd: totals.costUsd,
			totalTokens: totals.totalTokens,
			tokens: totals.tokens,
			records: totals.records,
			unpricedRecords: totals.unpricedRecords,
			unpricedTokens: totals.unpricedTokens,
			costShare: costUsd === 0 ? 0 : totals.costUsd / costUsd,
		}))
		.sort((a, b) => b.costUsd - a.costUsd || b.totalTokens - a.totalTokens);

	return { costUsd, totalTokens, sessions, providers, models, contractMismatches };
}

/** Returns null without input; cache writes count as misses because input was fully processed. */
export function cacheHitRate({ tokens }: Pick<ModelTotals, "tokens">): number | null {
	const input = tokens.uncachedInputTokens + tokens.cachedInputTokens + tokens.cacheCreationTokens;
	return input === 0 ? null : tokens.cachedInputTokens / input;
}

/** Effective USD per million priced tokens, or `null` when none were priced. */
export function costPerMillionTokens(model: ModelTotals): number | null {
	const pricedTokens = model.totalTokens - model.unpricedTokens;
	return pricedTokens <= 0 || isModelCostUnknown(model) ? null : (model.costUsd / pricedTokens) * 1_000_000;
}
