/**
 * Forks and merging them back, as T3 Code's timeline and Lineage panel do (packages/client-runtime/src/state/
 * {threadRelationships,threadWorkflows}.ts, apps/server/src/orchestration-v2/ThreadForkService.ts). Pure.
 */

export type ProjectedRun = { id: string; ordinal: number; status: string };

/** `OrchestrationV2ThreadShell.forkedFrom`: where a fork came from. */
export type ForkedFrom = { type: string; threadId?: string } | null;

/** `resolveMergeBackTargetThreadId`: the thread a fork merges back into; undefined for a thread that isn't a fork. */
export function mergeBackTarget(thread: { lineage?: { parentThreadId: string | null; relationshipToParent: string | null }; forkedFrom?: ForkedFrom }): string | undefined {
	if (thread.lineage?.relationshipToParent !== "fork") return undefined;
	return (thread.forkedFrom?.type === "run" ? thread.forkedFrom.threadId : thread.lineage.parentThreadId) ?? undefined;
}

const MERGE_BACK = new Set(["waiting", "completed"]);
const MERGE_BACK_BLOCKING = new Set(["preparing", "starting", "running"]);

/**
 * `resolveLatestMergeBackRun`: the newest run whose provider turn finished (`waiting` while its checkpoint is taken
 * counts), unless a newer run is under way.
 */
export function latestMergeBackRun(runs: readonly ProjectedRun[]): ProjectedRun | undefined {
	const latest = runs.reduce<ProjectedRun | undefined>((best, run) => (MERGE_BACK.has(run.status) && (best === undefined || run.ordinal > best.ordinal) ? run : best), undefined);
	if (latest === undefined) return undefined;
	return runs.some((run) => run.ordinal > latest.ordinal && MERGE_BACK_BLOCKING.has(run.status)) ? undefined : latest;
}

/** Run statuses the server forks from (`isForkableSourceRunStatus`). */
const FORKABLE = new Set(["completed", "waiting", "failed", "interrupted", "cancelled"]);

/** The run a fork starts from: the newest one that ended, like T3 Code's fork button on the latest reply. */
export function forkSourceRun(runs: readonly ProjectedRun[]): ProjectedRun | undefined {
	return runs.reduce<ProjectedRun | undefined>((best, run) => (FORKABLE.has(run.status) && (best === undefined || run.ordinal > best.ordinal) ? run : best), undefined);
}

/** A fork's title, as T3 Code names it. */
export const forkTitle = (title: string): string => `${title} fork`;

/** While a turn is under way the shell's latest run blocks merging back; the press reads the runs to be sure. */
export const mergeBlocked = (runStatus: string): boolean => MERGE_BACK_BLOCKING.has(runStatus);
