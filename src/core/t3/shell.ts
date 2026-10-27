/**
 * The live thread list from `orchestration.subscribeShell`, and the status and unread rules T3 Code's
 * sidebar uses (packages/client-runtime/src/state/{shellReducer,models,threadSettled}.ts,
 * apps/web/src/components/Sidebar.logic.ts). Pure: no I/O, no clock of its own.
 */

export type RunStatus = "preparing" | "queued" | "starting" | "running" | "waiting" | "completed" | "interrupted" | "failed" | "cancelled" | "rolled_back";
export type ThreadStatus = "idle" | RunStatus;
export type OptionValue = string | boolean;
export type ModelSelection = { instanceId: string; model: string; options?: { id: string; value: OptionValue }[] };
export type RuntimeMode = "approval-required" | "auto-accept-edits" | "auto" | "full-access";
export type InteractionMode = "default" | "plan";

/** What a key or dial shows, in priority order. */
export type DeckState = "approval" | "question" | "running" | "queued" | "done" | "failed" | "stopped" | "idle";

export type PendingRequestSummary = { id: string; kind: string; createdAt: string; blocking?: boolean };

type PullRequestLink = {
	number: number;
	url: string;
	source?: string;
	snapshot?: { state?: "open" | "closed" | "merged"; additions?: number; deletions?: number } | null;
};

/** The `OrchestrationV2ThreadShell` fields the deck reads. Absent and null mean the same unless noted. */
export type ThreadShell = {
	id: string;
	projectId: string;
	title: string;
	status: ThreadStatus;
	activityRunStatus?: "preparing" | "starting" | "running" | "waiting" | null;
	latestRunId: string | null;
	activeRunId: string | null;
	activeProviderThreadId?: string | null;
	latestRunRequestedAt?: string | null;
	latestRunStartedAt?: string | null;
	latestRunCompletedAt?: string | null;
	/** Absent only on servers that predate it; null means no run owns activity. */
	activityRunStartedAt?: string | null;
	lastErrorClass?: string | null;
	pendingRuntimeRequest: PendingRequestSummary | null;
	pendingGuestMessageCount?: number;
	pendingBackgroundTasks?: { kind: string; awaited?: boolean }[];
	lineage?: { parentThreadId: string | null; relationshipToParent: "fork" | "subagent" | null };
	creationSource?: string;
	modelSelection: ModelSelection;
	runtimeMode: RuntimeMode;
	interactionMode: InteractionMode;
	branch?: string | null;
	pullRequests?: PullRequestLink[];
	updatedAt: string;
	settledOverride?: "settled" | "active" | null;
	snoozedUntil?: string | null;
	snoozedAt?: string | null;
	pinnedAt?: string | null;
	lastVisitedAt?: string | null;
	deletedAt?: string | null;
};

export type ProjectShell = { id: string; title: string; workspaceRoot: string; defaultModelSelection?: ModelSelection | null; repositoryIdentity?: unknown };

export type ShellItem =
	| { kind: "synchronized" }
	| { kind: "snapshot"; snapshot: { snapshotSequence: number; projects: ProjectShell[]; threads: ThreadShell[] }; resolvedRepositoryIdentityRoots?: string[] }
	| { kind: "project.updated"; sequence: number; project: ProjectShell }
	| { kind: "project.removed"; sequence: number; projectId: string }
	| { kind: "thread.updated"; sequence: number; location: "active" | "archive"; thread: ThreadShell }
	| { kind: "thread.removed"; sequence: number; location: "active" | "archive"; threadId: string };

export type ShellState = { seq: number; projects: Map<string, ProjectShell>; threads: Map<string, ThreadShell>; synced: boolean };

/** Thread capabilities from `ServerConfig.environment.capabilities`; the shell filter honors only what the server supports. */
export type ThreadCapabilities = { threadSettlement?: boolean; threadSnooze?: boolean };

/**
 * Applies one stream item. Returns the next state, or the same one when nothing changed.
 * Only a snapshot without `resolvedRepositoryIdentityRoots` replaces the list; the enrichment snapshot a
 * resume sends carries no threads and must not wipe them.
 */
export function applyShellItem(state: ShellState | undefined, item: ShellItem): ShellState | undefined {
	switch (item.kind) {
		case "synchronized":
			return state === undefined ? state : { ...state, synced: true };
		case "snapshot":
			if (item.resolvedRepositoryIdentityRoots !== undefined) return state;
			return {
				seq: item.snapshot.snapshotSequence,
				projects: new Map(item.snapshot.projects.map((project) => [project.id, project])),
				threads: new Map(item.snapshot.threads.map((thread) => [thread.id, thread])),
				synced: state?.synced ?? false,
			};
	}
	const sequence = (item as { sequence?: unknown }).sequence;
	// No base yet, a stale or duplicate delta, or a kind this client does not know.
	if (state === undefined || typeof sequence !== "number" || sequence <= state.seq) return state;
	const next: ShellState = { ...state, seq: sequence };
	switch (item.kind) {
		case "project.updated":
			next.projects = new Map(state.projects).set(item.project.id, item.project);
			break;
		case "project.removed":
			next.projects = new Map(state.projects);
			next.projects.delete(item.projectId);
			break;
		case "thread.updated":
			next.threads = new Map(state.threads);
			if (item.location === "active") next.threads.set(item.thread.id, item.thread);
			else next.threads.delete(item.thread.id);
			break;
		case "thread.removed":
			next.threads = new Map(state.threads);
			next.threads.delete(item.threadId);
			break;
	}
	return next;
}

const TERMINAL = new Set<ThreadStatus>(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);
const LIVE = new Set<string>(["preparing", "starting", "running", "waiting"]);
const WORKING = new Set<string>(["preparing", "starting", "running"]);

const time = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/** The turn ended but delegated background work holds the thread open. */
const isParked = (thread: ThreadShell): boolean =>
	thread.status !== "failed" &&
	(thread.pendingBackgroundTasks ?? []).some((task) => task.awaited === true || task.kind === "subagent" || task.kind === "background_task");

/** `shellRuntime`: the status of the run that owns activity ("idle" when parked), or null for a thread that never ran. */
export function runtimeStatus(thread: ThreadShell): ThreadStatus | null {
	const parked = isParked(thread);
	if (thread.latestRunId == null && thread.activeProviderThreadId == null && !parked) return null;
	return parked ? "idle" : (thread.activityRunStatus ?? thread.status);
}

/** When the current run's work started, for the elapsed timer. */
export function activeSince(thread: ThreadShell): number | undefined {
	let start: string | null | undefined;
	if (thread.activityRunStartedAt !== undefined) start = thread.activityRunStartedAt;
	else if (thread.latestRunCompletedAt == null && thread.latestRunId === thread.activeRunId) start = thread.latestRunStartedAt ?? thread.latestRunRequestedAt;
	const ms = time(start);
	return Number.isNaN(ms) ? undefined : ms;
}

function completedAt(thread: ThreadShell): string | null {
	if (thread.latestRunId == null) return null;
	if (thread.latestRunCompletedAt !== undefined) return thread.latestRunCompletedAt;
	return thread.status === "idle" || TERMINAL.has(thread.status) ? thread.updatedAt : null;
}

/** Unread the way T3 Code's sidebar counts it, so reading on the deck and in the app stay in sync. */
export function isUnseen(thread: ThreadShell): boolean {
	const visited = thread.lastVisitedAt;
	const completed = completedAt(thread);
	if (thread.status === "failed") return !visited || !(time(completed) <= time(visited));
	if (!completed || !visited) return false;
	return time(completed) > time(visited);
}

const isSubagent = (thread: ThreadShell) => thread.lineage?.relationshipToParent === "subagent";
const requestClass = (kind: string): "approval" | "question" | undefined =>
	kind === "auth_refresh" ? undefined : kind === "user_input" ? "question" : "approval";

/** A delegated child's live request surfaces on every ancestor, so the user sees it where they look. */
function liftedRequests(threads: Map<string, ThreadShell>): Map<string, { request: PendingRequestSummary; threadId: string }> {
	const lifted = new Map<string, { request: PendingRequestSummary; threadId: string }>();
	for (const child of threads.values()) {
		const request = child.pendingRuntimeRequest;
		if (!isSubagent(child) || child.creationSource === "provider" || request == null || requestClass(request.kind) === undefined) continue;
		if (child.activityRunStatus == null && !(child.activityRunStatus === undefined && LIVE.has(child.status))) continue;
		const seen = new Set([child.id]);
		for (let parentId = child.lineage?.parentThreadId; parentId != null && !seen.has(parentId); parentId = threads.get(parentId)?.lineage?.parentThreadId) {
			seen.add(parentId);
			const current = lifted.get(parentId);
			if (current === undefined || (requestClass(current.request.kind) === "question" && requestClass(request.kind) === "approval")) {
				lifted.set(parentId, { request, threadId: child.id });
			}
		}
	}
	return lifted;
}

/** Snoozed until a hand goes up: any request (its own or a child's), a guest message, or a failure after snoozing. */
function effectiveSnoozed(thread: ThreadShell, childAsks: boolean, now: number): boolean {
	if (!(time(thread.snoozedUntil) > now)) return false;
	if (thread.pendingRuntimeRequest != null || childAsks || (thread.pendingGuestMessageCount ?? 0) > 0) return false;
	if (thread.status !== "failed") return true;
	return thread.snoozedAt != null && !(time(thread.latestRunCompletedAt ?? thread.updatedAt) > time(thread.snoozedAt));
}

/** A thread the deck lists: top-level, not deleted, settled or snoozed (archived ones never arrive). */
function listed(thread: ThreadShell, childAsks: boolean, capabilities: ThreadCapabilities, now: number): boolean {
	if (isSubagent(thread) || thread.deletedAt != null) return false;
	if (capabilities.threadSettlement === true && thread.settledOverride === "settled") return false;
	return !(capabilities.threadSnooze === true && effectiveSnoozed(thread, childAsks, now));
}

/** The earliest snooze that ends after `now`: the server sends nothing then, so the caller re-derives at that time. */
export function nextSnoozeWake(state: ShellState, now: number): number | undefined {
	let next: number | undefined;
	for (const thread of state.threads.values()) {
		const until = time(thread.snoozedUntil);
		if (until > now && (next === undefined || until < next)) next = until;
	}
	return next;
}

/** One deck row, before the board adds which machine it came from. */
export type ShellRow = {
	threadId: string;
	projectId: string;
	projectTitle: string;
	title: string;
	deck: DeckState;
	runStatus: ThreadStatus;
	/** A run is in flight: timer, Stop and the once-a-second clock follow this. */
	active: boolean;
	activeSince: number | undefined;
	activeRunId: string | null;
	unseen: boolean;
	pinned: boolean;
	model: ModelSelection;
	runtimeMode: RuntimeMode;
	interactionMode: InteractionMode;
	branch: string | undefined;
	pullRequests: { url: string; number: number; state: "open" | "closed" | "merged" | undefined; additions?: number; deletions?: number }[];
	/** What blocks this thread. `threadId` owns the request: a delegated child's when it was lifted. */
	pendingRequest: { id: string; kind: string; createdAt: string; threadId: string } | undefined;
	parentThreadId: string | null;
	updatedAt: number;
};

/** Sidebar status priority (resolveSidebarThreadStatus), folded onto the deck's states. */
export function deckState(thread: ThreadShell, runtime: ThreadStatus | null, blocker: "approval" | "question" | undefined): DeckState {
	if (blocker !== undefined) return blocker;
	switch (runtime) {
		case "preparing":
		case "starting":
		case "running":
		case "waiting":
			return "running";
		case "queued":
			return "queued";
		case "failed":
			return "failed";
	}
	if (runtime === "idle" && isParked(thread)) return "queued";
	if (thread.status === "interrupted" || thread.status === "cancelled") return "stopped";
	if (thread.status === "completed") return "done";
	return "idle";
}

export function shellRows(state: ShellState, capabilities: ThreadCapabilities, now: number): ShellRow[] {
	const lifted = liftedRequests(state.threads);
	const rows: ShellRow[] = [];
	for (const thread of state.threads.values()) {
		const child = lifted.get(thread.id);
		if (!listed(thread, child !== undefined, capabilities, now)) continue;
		const runtime = runtimeStatus(thread);
		const own = thread.pendingRuntimeRequest;
		const ownClass = own == null ? undefined : requestClass(own.kind);
		const ownBlocks = ownClass === "approval" || (ownClass === "question" && (own!.blocking !== false || !WORKING.has(runtime ?? "")));
		const pending =
			ownBlocks && (ownClass === "approval" || child === undefined || requestClass(child.request.kind) !== "approval")
				? { ...own!, threadId: thread.id }
				: child !== undefined
					? { ...child.request, threadId: child.threadId }
					: undefined;
		const deck = deckState(thread, runtime, pending === undefined ? undefined : requestClass(pending.kind));
		const active = runtime !== null && (LIVE.has(runtime) || runtime === "queued");
		rows.push({
			threadId: thread.id,
			projectId: thread.projectId,
			projectTitle: state.projects.get(thread.projectId)?.title ?? "",
			title: thread.title,
			deck,
			runStatus: runtime ?? "idle",
			active,
			activeSince: active ? activeSince(thread) : undefined,
			activeRunId: thread.activeRunId,
			unseen: (deck === "done" || deck === "failed" || deck === "stopped") && isUnseen(thread),
			pinned: thread.pinnedAt != null,
			model: thread.modelSelection,
			runtimeMode: thread.runtimeMode,
			interactionMode: thread.interactionMode,
			branch: thread.branch ?? undefined,
			pullRequests: (thread.pullRequests ?? [])
				.filter((link) => link.source !== "stack-dismissed")
				.map((link) => ({
					url: link.url,
					number: link.number,
					state: link.snapshot?.state,
					additions: link.snapshot?.additions,
					deletions: link.snapshot?.deletions,
				})),
			pendingRequest: pending === undefined ? undefined : { id: pending.id, kind: pending.kind, createdAt: pending.createdAt, threadId: pending.threadId },
			parentThreadId: thread.lineage?.parentThreadId ?? null,
			updatedAt: time(thread.updatedAt),
		});
	}
	return rows;
}
