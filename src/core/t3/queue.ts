/**
 * A thread's queued messages, derived from its projection the way T3 Code's composer does
 * (packages/client-runtime/src/state/threadWorkflows.ts `deriveThreadQueueWorkflowState`). Pure.
 */

type Run = {
	id: string;
	ordinal: number;
	userMessageId: string;
	status: string;
	queuePosition?: number | null;
	queueHeld?: boolean;
	activeAttemptId?: string | null;
	providerThreadId?: string | null;
};

type Message = { id: string; text?: string; context?: { guest?: { text?: string } }; delegatedCompletion?: unknown; notification?: unknown };

type TurnCapabilities = { supportsActiveSteering?: boolean; supportsSteeringByInterruptRestart?: boolean };

/** The `OrchestrationV2ThreadProjection` slice the queue reads. */
export type QueueProjection = {
	thread?: { id?: string; activeProviderThreadId?: string | null };
	runs?: Run[];
	messages?: Message[];
	providerThreads?: { id: string; appThreadId?: string; providerSessionId?: string | null }[];
	providerSessions?: { id: string; status?: string; capabilities?: { turns?: TurnCapabilities } }[];
	providerTurns?: { runAttemptId?: string | null; status?: string }[];
};

export type QueuedMessage = { runId: string; text: string };

export type ThreadQueue = {
	items: QueuedMessage[];
	/** The run a promote steers; null when nothing runs. */
	activeRunId: string | null;
	/** Stop held the queue: nothing starts until the user sends one now. */
	held: boolean;
	/** Nothing runs, so a queued message can start right away. */
	canSendNow: boolean;
	/** A running provider turn takes steering, so a queued message can join it. */
	canPromote: boolean;
};

const ACTIVE = new Set(["preparing", "starting", "running", "waiting"]);

export const EMPTY_QUEUE: ThreadQueue = { items: [], activeRunId: null, held: false, canSendNow: false, canPromote: false };

export function threadQueue(projection: QueueProjection): ThreadQueue {
	const runs = projection.runs ?? [];
	const messages = projection.messages ?? [];
	const automatic = new Set(messages.filter((message) => message.delegatedCompletion !== undefined || message.notification !== undefined).map((message) => message.id));
	const queued = runs.filter((run) => run.status === "queued" && !automatic.has(run.userMessageId));
	queued.sort((a, b) => (a.queuePosition ?? a.ordinal) - (b.queuePosition ?? b.ordinal) || a.ordinal - b.ordinal);
	const active = runs.findLast((run) => ACTIVE.has(run.status)) ?? null;
	const steerable =
		active?.status === "running" &&
		active.activeAttemptId != null &&
		(projection.providerTurns ?? []).some((turn) => turn.runAttemptId === active.activeAttemptId && turn.status === "running");
	const turns = steerable ? sessionTurns(projection, active) : undefined;
	return {
		items: queued.map((run) => {
			const message = messages.find((candidate) => candidate.id === run.userMessageId);
			// A queued guest message shows the guest's words, as in T3 Code.
			return { runId: run.id, text: message?.context?.guest?.text ?? message?.text ?? "" };
		}),
		activeRunId: active?.id ?? null,
		held: queued.some((run) => run.queueHeld === true),
		canSendNow: active === null,
		canPromote: steerable && (turns?.supportsActiveSteering === true || turns?.supportsSteeringByInterruptRestart === true),
	};
}

/** The provider session's turn capabilities, found the way T3 Code finds the thread's session. */
function sessionTurns(projection: QueueProjection, active: Run | null): TurnCapabilities | undefined {
	const threads = projection.providerThreads ?? [];
	const providerThreadId = active?.providerThreadId ?? projection.thread?.activeProviderThreadId ?? null;
	const attached =
		(providerThreadId === null ? undefined : threads.find((thread) => thread.id === providerThreadId)) ??
		threads.find((thread) => thread.appThreadId === projection.thread?.id && thread.providerSessionId != null);
	const sessions = projection.providerSessions ?? [];
	const sessionId = attached?.providerSessionId;
	const session = sessionId != null ? sessions.find((candidate) => candidate.id === sessionId) : sessions.findLast((candidate) => candidate.status !== "stopped" && candidate.status !== "error");
	return session?.capabilities?.turns;
}

/** What a press does to the shown message: start it (nothing runs, or the queue is held), steer it in, or nothing yet. */
export function queuePress(queue: ThreadQueue): "start" | "steer" | undefined {
	if (queue.canSendNow) return "start";
	if (queue.canPromote && queue.activeRunId !== null) return "steer";
	return undefined;
}
