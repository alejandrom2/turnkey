/**
 * Usage summaries per machine and period, read the way T3 Code's clients read them: kept a minute before a show reads
 * again (its `staleTimeMs`), read again every five minutes while shown, and in two steps when a source (Cursor's
 * account) answers from a stale cache. T3 Code scans its transcript folders on every call, so nothing else reads.
 */
import { makeWindow } from "./format.js";
import { type EnvironmentUsage, type MergedUsage, mergeUsage } from "./merge.js";
import { USAGE_CONTRACT_VERSION, type UsageSummary, type UsageSummaryInput } from "./types.js";

/** T3 Code's Usage periods (`WINDOW_OPTIONS`): the past 24 hours by the hour, else calendar days up to today. */
export const USAGE_PERIODS = [1, 7, 30, 90] as const;
export type UsagePeriod = (typeof USAGE_PERIODS)[number];

/** T3 Code's Usage page opens on 30 days. */
export const usagePeriod = (value: unknown): UsagePeriod => USAGE_PERIODS.find((period) => String(period) === String(value)) ?? 30;

export const periodInput = (period: UsagePeriod, now: Date): UsageSummaryInput => makeWindow(period, now, period === 1 ? "hour" : "day");

/** The machine side of a read. */
export interface UsageReader {
	readonly url: string;
	readonly environmentId: string;
	readonly label: string;
	/** Changes when settings the scan depends on change (price overrides, model aliases, Cursor's keychain). */
	readonly usageSettingsStamp: string;
	usageSummary(input: UsageSummaryInput): Promise<UsageSummary>;
}

export type UsageEntry = {
	summary?: UsageSummary;
	error?: unknown;
	/** A read is in flight. */
	loading: boolean;
	/** The summary shown is a cached answer, and the full one is on its way. */
	refreshing: boolean;
	fetchedAt: number;
	stamp: string;
	scanDurationMs?: number;
};

export const USAGE_FRESH_MS = 60_000;
export const USAGE_REFETCH_MS = 5 * 60_000;
/** Scans slower than this read again half as often; T3 Code doesn't, the deck spares the host. */
export const SLOW_SCAN_MS = 2_000;

export class UsageStore {
	readonly #entries = new Map<string, UsageEntry>();
	readonly #reads = new Map<string, Promise<void>>();

	constructor(
		private readonly onChange: () => void,
		private readonly now: () => number = Date.now,
		private readonly onScan: (reader: UsageReader, summary: UsageSummary) => void = () => undefined,
	) {}

	entry(reader: Pick<UsageReader, "url">, period: UsagePeriod): UsageEntry | undefined {
		return this.#entries.get(`${reader.url}|${period}`);
	}

	/** Reads unless a read younger than `maxAge`, under the same settings, is kept or running. */
	ensure(reader: UsageReader, period: UsagePeriod, maxAge = USAGE_FRESH_MS): void {
		const entry = this.entry(reader, period);
		if (entry?.loading) return;
		if (entry !== undefined && entry.stamp === reader.usageSettingsStamp && this.now() - entry.fetchedAt < maxAge) return;
		void this.refresh(reader, period);
	}

	/** Whether a shown entry is due its periodic read. */
	due(reader: UsageReader, period: UsagePeriod): boolean {
		const entry = this.entry(reader, period);
		if (entry === undefined) return true;
		if (entry.loading) return false;
		const every = (entry.scanDurationMs ?? 0) > SLOW_SCAN_MS ? 2 * USAGE_REFETCH_MS : USAGE_REFETCH_MS;
		return entry.stamp !== reader.usageSettingsStamp || this.now() - entry.fetchedAt >= every;
	}

	/**
	 * Reads now, joining a read already running, or with `after` reading again once it ends (new prices must not land
	 * in a scan that started before them). The window is computed now, so it rolls past midnight.
	 */
	refresh(reader: UsageReader, period: UsagePeriod, after = false): Promise<void> {
		const key = `${reader.url}|${period}`;
		const running = this.#reads.get(key);
		if (running !== undefined) return after ? running.then(() => this.refresh(reader, period)) : running;
		const read = this.#read(key, reader, period).finally(() => this.#reads.delete(key));
		this.#reads.set(key, read);
		return read;
	}

	async #read(key: string, reader: UsageReader, period: UsagePeriod): Promise<void> {
		const previous = this.#entries.get(key);
		const entry: UsageEntry = { ...previous, loading: true, refreshing: false, fetchedAt: previous?.fetchedAt ?? 0, stamp: reader.usageSettingsStamp };
		this.#entries.set(key, entry);
		this.onChange();
		const input = periodInput(period, new Date(this.now()));
		try {
			const first = await reader.usageSummary(input);
			this.#keep(entry, reader, first);
			if (first.sources.some((source) => source.refreshing === true)) {
				entry.refreshing = true;
				this.onChange();
				try {
					this.#keep(entry, reader, await reader.usageSummary({ ...input, awaitRefresh: true }));
				} catch {
					// The first answer stands, as in T3 Code.
				}
			}
		} catch (error) {
			entry.error = error;
			entry.fetchedAt = this.now();
		} finally {
			entry.loading = false;
			entry.refreshing = false;
			this.onChange();
		}
	}

	#keep(entry: UsageEntry, reader: UsageReader, summary: UsageSummary): void {
		entry.summary = summary;
		entry.error = undefined;
		entry.fetchedAt = this.now();
		entry.scanDurationMs = summary.scanDurationMs;
		this.onScan(reader, summary);
	}

	/**
	 * The period across `readers`, merged as T3 Code merges environments. `loading` while any is still on its way (the
	 * figures dim, as T3 Code's do); `error` is the first failure when nothing answered.
	 */
	view(readers: readonly UsageReader[], period: UsagePeriod): { merged?: MergedUsage; loading: boolean; error?: unknown; mismatch?: "serverBehind" | "clientBehind" } {
		const entries = readers.map((reader) => ({ reader, entry: this.entry(reader, period) }));
		const answered: EnvironmentUsage[] = entries.flatMap(({ reader, entry }) =>
			entry?.summary === undefined ? [] : [{ environmentId: reader.environmentId, label: reader.label, summary: entry.summary }],
		);
		const loading = entries.some(({ entry }) => entry === undefined || entry.loading || entry.refreshing);
		if (answered.length === 0) return { loading, error: entries.find(({ entry }) => entry?.error !== undefined)?.entry?.error };
		const merged = mergeUsage(answered, USAGE_CONTRACT_VERSION);
		// Every answer was a contract version this port can't merge: say who needs updating rather than show $0.00.
		const [mismatch] = merged.contractMismatches;
		if (merged.contributingEnvironments.length === 0 && mismatch !== undefined) return { loading, mismatch: mismatch.direction };
		return { merged, loading };
	}
}
