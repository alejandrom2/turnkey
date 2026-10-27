/**
 * Workflows a thread runs, read from its projection's subagents the way T3 Code's Lineage panel offers Stop workflow
 * (apps/web/src/components/chat/ThreadRelationshipsControl.tsx, packages/client-runtime/src/state/subagentRuntime.ts).
 * Pure.
 */
import { type MessageKey, t } from "./i18n.js";

/** The `OrchestrationV2Subagent` fields the deck reads. */
export type ProjectedSubagent = {
	id: string;
	origin?: string;
	driver?: string;
	status?: string;
	title?: string | null;
	workflow?: { name?: string };
};

export type RunningWorkflow = { id: string; name: string | undefined };

/** Workflows T3 Code would let a user stop: running, provider-native, on Claude (the one provider that can stop them). */
export function runningWorkflows(projection: { subagents?: ProjectedSubagent[] } | undefined): RunningWorkflow[] {
	return (projection?.subagents ?? [])
		.filter((subagent) => subagent.workflow !== undefined && subagent.status === "running" && subagent.origin === "provider_native" && subagent.driver === "claudeAgent")
		.map((subagent) => ({ id: subagent.id, name: subagent.workflow?.name ?? subagent.title ?? undefined }));
}

/** Only Claude's provider-native workflows can be stopped, so other drivers never offer it. */
export const canStopWorkflows = (driver: string | undefined): boolean => driver === "claudeAgent";

const STOP_REASON: Record<string, MessageKey> = {
	"not-running": "workflow.notRunning",
	unsupported: "workflow.unsupported",
	unavailable: "workflow.unavailable",
	"stop-failed": "workflow.stopFailed",
};

/** `OrchestrationV2StopWorkflowError`'s reason, in the deck's words. */
export const stopWorkflowFailure = (code: string | undefined): string | undefined => (code === undefined || STOP_REASON[code] === undefined ? undefined : t(STOP_REASON[code]));
