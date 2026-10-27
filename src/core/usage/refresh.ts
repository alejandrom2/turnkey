/**
 * Ported from `refreshUsageLimits` in T3 Code's packages/client-runtime/src/state/usage.ts: one limits refresh in
 * flight per environment, and automatic ones at most every five minutes after any refresh ends, failed or not. A
 * manual refresh always runs, sharing one already in flight.
 */
export const LIMITS_REFRESH_GAP_MS = 5 * 60_000;

export class LimitsRefresher {
	readonly #after = new Map<string, number>();
	readonly #pending = new Map<string, Promise<unknown>>();

	constructor(private readonly now: () => number = Date.now) {}

	async refresh<A>(environmentId: string, refresh: () => Promise<A>, automatic = false, afterPending = false): Promise<A | undefined> {
		const pending = this.#pending.get(environmentId);
		if (pending !== undefined) {
			if (afterPending) {
				try {
					await pending;
				} catch {}
				return this.refresh(environmentId, refresh, false, true);
			}
			return automatic ? undefined : ((await pending) as A);
		}
		const refreshAfter = this.#after.get(environmentId) ?? 0;
		if (automatic && this.now() < refreshAfter) return;
		const current = Promise.resolve()
			.then(refresh)
			.finally(() => {
				this.#pending.delete(environmentId);
				this.#after.set(environmentId, this.now() + LIMITS_REFRESH_GAP_MS);
			});
		this.#pending.set(environmentId, current);
		return await current;
	}

	/** Whether a refresh for the environment is in flight. */
	pending(environmentId: string): boolean {
		return this.#pending.has(environmentId);
	}
}
