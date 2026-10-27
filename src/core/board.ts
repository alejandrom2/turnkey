import type { ConnectionState } from "./connection.js";
import { isActive, type Project, type ThreadDetail, type ThreadListItem, type ThreadStatus, type ToolCaller } from "./t3.js";

export interface BoardSource extends ToolCaller {
	readonly url: string;
	readonly state: ConnectionState;
}

/** What a key or dial shows, in priority order. */
export type DeckState = "approval" | "question" | "running" | "queued" | "done" | "failed" | "stopped" | "idle";

export type DeckThread = {
	key: string;
	source: BoardSource;
	environmentId: string;
	projectId: string;
	projectTitle: string;
	threadId: string;
	title: string;
	status: ThreadStatus;
	deck: DeckState;
	model: string;
	providerInstanceId: string;
	activeSince: number | undefined;
	unseen: boolean;
	questions: number;
	approvals: number;
};

export type BoardOptions = {
	activeIntervalMs: number;
	idleIntervalMs: number;
	projectsTtlMs: number;
	maxProjects: number;
	threadsPerProject: number;
	now: () => number;
};

const DEFAULTS: BoardOptions = {
	activeIntervalMs: 2_000,
	idleIntervalMs: 15_000,
	projectsTtlMs: 60_000,
	maxProjects: 12,
	threadsPerProject: 20,
	now: Date.now,
};

const RANK: Record<DeckState, number> = { approval: 0, question: 1, running: 2, queued: 3, failed: 4, done: 5, stopped: 6, idle: 7 };

/**
 * Merges the threads of every connected environment into one ordered list.
 * Polls only while something on the deck is visible, faster while a turn is active.
 */
export class ThreadBoard {
	threads: DeckThread[] = [];
	#focusKey: string | undefined;
	readonly #options: BoardOptions;
	readonly #listeners = new Set<() => void>();
	readonly #projects = new Map<string, { at: number; projects: Project[] }>();
	readonly #activeSince = new Map<string, number>();
	readonly #unseen = new Set<string>();
	#timer: ReturnType<typeof setTimeout> | undefined;
	#running = false;
	#refreshing: Promise<void> | undefined;
	#waitingOn: string | undefined;
	/** Last fetched threads per environment+project; idle projects are reused between full passes. */
	readonly #byProject = new Map<string, DeckThread[]>();
	#lastFullAt = Number.NEGATIVE_INFINITY;

	constructor(
		private readonly sources: () => readonly BoardSource[],
		options: Partial<BoardOptions> = {},
	) {
		this.#options = { ...DEFAULTS, ...options };
	}

	subscribe(listener: () => void): () => void {
		this.#listeners.add(listener);
		return () => this.#listeners.delete(listener);
	}

	get focused(): DeckThread | undefined {
		return this.focusedOn();
	}

	/** Threads of one machine (its MCP URL), or of every machine when `machine` is empty. */
	threadsOn(machine?: string): DeckThread[] {
		return machine ? this.threads.filter((thread) => thread.source.url === machine) : this.threads;
	}

	/** Focus is shared across the deck; an action pinned to a machine sees that machine's first thread instead. */
	focusedOn(machine?: string): DeckThread | undefined {
		const threads = this.threadsOn(machine);
		return threads.find((thread) => thread.key === this.#focusKey) ?? threads[0];
	}

	focus(key: string): void {
		this.#focusKey = key;
		this.#emit();
	}

	/** Moves focus by `steps` through one machine's threads (or all), clamped at both ends. */
	moveFocus(steps: number, machine?: string): void {
		const threads = this.threadsOn(machine);
		if (threads.length === 0) return;
		const current = Math.max(0, threads.indexOf(this.focusedOn(machine)!));
		const next = Math.min(threads.length - 1, Math.max(0, current + steps));
		this.focus(threads[next].key);
	}

	markSeen(key: string): void {
		if (this.#unseen.delete(key)) {
			this.#rebuild(this.threads.map((thread) => (thread.key === key ? { ...thread, unseen: false } : thread)));
		}
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		void this.refresh();
	}

	stop(): void {
		this.#running = false;
		clearTimeout(this.#timer);
		this.#timer = undefined;
	}

	/**
	 * Refreshes now; concurrent callers share one pass. Between full passes only projects with an
	 * active thread are re-read; pass `full` after a user action that may wake an idle project.
	 */
	refresh(full = false): Promise<void> {
		if (full) this.#lastFullAt = Number.NEGATIVE_INFINITY;
		this.#refreshing ??= this.#poll().finally(() => {
			this.#refreshing = undefined;
			this.#schedule();
		});
		return this.#refreshing;
	}

	async #poll(): Promise<void> {
		const ready = this.sources().filter((source) => source.state.kind === "ready");
		const now = this.#options.now();
		const full = now - this.#lastFullAt >= this.#options.idleIntervalMs;
		if (full) this.#lastFullAt = now;
		const lists = await Promise.all(ready.map((source) => this.#readSource(source, full).catch(() => [] as DeckThread[])));
		this.#rebuild(lists.flat());
		this.#watchFocused();
	}

	async #readSource(source: BoardSource, full: boolean): Promise<DeckThread[]> {
		if (source.state.kind !== "ready") return [];
		const environmentId = source.state.environmentId;
		const projects = (await this.#projectsOf(source)).slice(0, this.#options.maxProjects);
		const perProject = await Promise.all(
			projects.map(async (project) => {
				const key = `${source.url}#${project.id}`;
				const cached = this.#byProject.get(key);
				if (!full && cached !== undefined && !cached.some((thread) => isActive(thread.status))) {
					return cached.map((thread) => ({ ...thread, unseen: this.#unseen.has(thread.key) }));
				}
				try {
					const { threads } = await source.call<{ threads: ThreadListItem[] }>("t3_thread_list", {
						projectId: project.id,
						settled: false,
						snoozed: false,
						limit: this.#options.threadsPerProject,
					});
					const fresh = await Promise.all(threads.map((item) => this.#toDeckThread(source, environmentId, project, item)));
					this.#byProject.set(key, fresh);
					return fresh;
				} catch {
					return cached ?? [];
				}
			}),
		);
		return perProject.flat();
	}

	async #projectsOf(source: BoardSource): Promise<Project[]> {
		const cached = this.#projects.get(source.url);
		const now = this.#options.now();
		if (cached !== undefined && now - cached.at < this.#options.projectsTtlMs) return cached.projects;
		const { projects } = await source.call<{ projects: Project[] }>("t3_project_list", { limit: 100 });
		this.#projects.set(source.url, { at: now, projects });
		return projects;
	}

	async #toDeckThread(source: BoardSource, environmentId: string, project: Project, item: ThreadListItem): Promise<DeckThread> {
		const key = `${environmentId}/${item.threadId}`;
		const active = isActive(item.status);
		const wasActive = this.#activeSince.has(key);
		if (active && !wasActive) this.#activeSince.set(key, this.#options.now());
		if (!active && wasActive) {
			this.#activeSince.delete(key);
			if (item.status !== "cancelled" && item.status !== "rolled_back") this.#unseen.add(key);
		}

		let questions = 0;
		let approvals = 0;
		// Only active top-level threads can be blocked on the user. Reading a delegated child marks its result delivered.
		if (active && item.parentThreadId === null) {
			const detail = await source.call<ThreadDetail>("t3_thread_read", { threadId: item.threadId, limit: 1, maxCharsPerItem: 1 });
			if (detail.pendingRequestCount > 0) {
				const { requestIds } = await source.call<{ requestIds: string[] }>("t3_pending_request", { action: "list", threadId: item.threadId });
				questions = requestIds.length;
				approvals = Math.max(0, detail.pendingRequestCount - questions);
			}
		}

		return {
			key,
			source,
			environmentId,
			projectId: project.id,
			projectTitle: project.title,
			threadId: item.threadId,
			title: item.title,
			status: item.status,
			deck: deckState(item.status, approvals, questions),
			model: item.model,
			providerInstanceId: item.providerInstanceId,
			activeSince: this.#activeSince.get(key),
			unseen: this.#unseen.has(key),
			questions,
			approvals,
		};
	}

	/** Long-polls the focused active thread so completion shows without waiting for the next tick. */
	#watchFocused(): void {
		const thread = this.focused;
		if (!this.#running || thread === undefined || !isActive(thread.status) || this.#waitingOn === thread.key) return;
		this.#waitingOn = thread.key;
		const startedAt = Date.now();
		thread.source
			.call("t3_thread_wait", { threadId: thread.threadId, timeoutMs: 25_000 })
			.catch(() => undefined)
			.finally(() => {
				if (this.#waitingOn === thread.key) this.#waitingOn = undefined;
				// A wait that fails or returns at once must not loop at request latency; the next tick covers it.
				if (this.#running && Date.now() - startedAt >= 1_000) void this.refresh();
			});
	}

	#rebuild(threads: DeckThread[]): void {
		this.threads = threads.sort((a, b) => RANK[effective(a)] - RANK[effective(b)] || (b.activeSince ?? 0) - (a.activeSince ?? 0));
		this.#emit();
	}

	#schedule(): void {
		clearTimeout(this.#timer);
		if (!this.#running) return;
		const anyActive = this.threads.some((thread) => isActive(thread.status));
		this.#timer = setTimeout(() => void this.refresh(), anyActive ? this.#options.activeIntervalMs : this.#options.idleIntervalMs);
	}

	#emit(): void {
		for (const listener of this.#listeners) listener();
	}
}

/** Unseen finished threads sort with their result; seen ones fall back to idle. */
const effective = (thread: DeckThread): DeckState =>
	(thread.deck === "done" || thread.deck === "failed" || thread.deck === "stopped") && !thread.unseen ? "idle" : thread.deck;

export function deckState(status: ThreadStatus, approvals: number, questions: number): DeckState {
	if (approvals > 0) return "approval";
	if (questions > 0) return "question";
	switch (status) {
		case "preparing":
		case "starting":
		case "running":
			return "running";
		case "queued":
			return "queued";
		case "waiting":
		case "completed":
			return "done";
		case "failed":
			return "failed";
		case "interrupted":
			return "stopped";
		default:
			return "idle";
	}
}
