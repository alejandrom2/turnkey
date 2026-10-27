import { type MessageKey, t } from "../i18n.js";
import type { ConfigProvider, ModelConfig, ModelPreferences } from "../models.js";
import { readUsageSummary, type ResetCreditInput, type ResetCreditOutcome, type UsageLimitSourceSnapshot, type UsageSummary, type UsageSummaryInput } from "../usage/types.js";
import { type Credential, DIAGNOSTICS_SCOPE, OPERATE_SCOPE, PairingError, PROVIDERS_SCOPE, READ_SCOPE, redeemPairingCode, socketUrl } from "./pairing.js";
import { type VcsRef, worktreeBase } from "../git.js";
import { forkSourceRun, forkTitle, latestMergeBackRun, type ProjectedRun } from "../lineage.js";
import { type ProviderSkill, threadSkills, WORKSPACE_SNAPSHOT_TTL_MS, type WorkspaceSnapshot } from "../skills.js";
import { readTasks, type ScheduledTask } from "../tasks.js";
import { type ProjectedSubagent, type RunningWorkflow, runningWorkflows, stopWorkflowFailure } from "../workflows.js";
import { type QueueProjection, type ThreadQueue, threadQueue } from "./queue.js";
import { RpcError, RpcSocket, type RpcState, type SocketFactory } from "./rpc.js";
import {
	applyShellItem,
	type InteractionMode,
	type ModelSelection,
	nextSnoozeWake,
	type ProjectShell,
	type RuntimeMode,
	type ShellItem,
	type ShellRow,
	shellRows,
	type ShellState,
	type ThreadCapabilities,
} from "./shell.js";

export type MachineState =
	| { kind: "signed-out"; message?: string }
	| { kind: "connecting" }
	| { kind: "ready"; environmentId: string; label: string; canOperate: boolean }
	| { kind: "error"; message: string };

export interface CredentialStore {
	load(url: string): Credential | undefined;
	save(url: string, credential: Credential | undefined): Promise<void>;
}

/** Everything that touches the outside world, injected so tests never reach a real server. */
export type MachineDeps = {
	fetch: typeof fetch;
	socket: SocketFactory;
	now?: () => number;
	random?: () => number;
	uuid?: () => string;
};

type Capabilities = ThreadCapabilities & {
	serverResolvedCommandContext?: boolean;
	threadStop?: boolean;
	threadPinning?: boolean;
	threadVisitedTracking?: boolean;
};

type ProjectDefaults = { defaultModelSelection?: ModelSelection | null; defaultRuntimeMode?: RuntimeMode; newWorktreesStartFromOrigin?: boolean };

/** The settings a usage scan depends on: a change makes T3 Code's own clients read usage again. */
type UsageSettings = { usagePriceOverrides?: unknown; usageModelAliases?: unknown; cursorKeychainUsageEnabled?: unknown };

/** The `ServerConfig` slice the deck reads (packages/contracts/src/server.ts). */
type ServerConfig = {
	environment?: { label?: string; capabilities?: Capabilities };
	providers?: ConfigProvider[];
	settings?: ProjectDefaults & ModelPreferences & UsageSettings & { projectSettingsOverrides?: Record<string, ProjectDefaults> };
	shellResumeCompletionMarker?: boolean;
	shellThreadFamilies?: boolean;
	shellOlderSettled?: boolean;
	scratchWorkspaceRoot?: string;
	/** Editor ids this machine can launch (packages/contracts/src/editor.ts); newer ids may appear. */
	availableEditors?: string[];
};

/** Composer context sent with a message (`OrchestrationMessageContext`): review comments a handoff attaches. */
export type MessageContext = { version: 1; records: Record<string, unknown>[] };

/** Where a launched thread works (`OrchestrationV2ThreadLaunchWorkspaceStrategy`). */
export type WorkspaceStrategy =
	| { type: "root"; branch?: string }
	| { type: "existing_worktree"; worktreePath: string; branch?: string }
	| { type: "worktree"; baseRef: string; branch?: string; startFromOrigin?: boolean };

export type Decision = "accept" | "acceptForSession" | "acceptAlways" | "decline" | "cancel";
export type Question = {
	id: string;
	header: string;
	question: string;
	options: { label: string; description?: string; value?: string }[];
	multiSelect?: boolean;
	required?: boolean;
};
export type PendingRequest =
	| { type: "approval"; threadId: string; requestId: string; heading: string; summary: string; decisions: Decision[] }
	| { type: "question"; threadId: string; requestId: string; questions: Question[]; messageMode: boolean }
	| { type: "unsupported"; threadId: string; requestId: string; heading: string };

export type SendMode = "auto" | "queue" | "steer" | "restart";

/** A `subscribeServerConfig` event, the parts the deck reads (packages/contracts/src/server.ts). */
type ConfigEvent = {
	type?: string;
	config?: ServerConfig;
	payload?: { providers?: ConfigProvider[]; settings?: ServerConfig["settings"]; sources?: UsageLimitSourceSnapshot[] };
};

/** T3 Code's composer retries a checkout's skills read this long after a failure, at most three times in a row. */
const WORKSPACE_RETRY_MS = 10_000;
const WORKSPACE_MAX_FAILURES = 3;

/** One checkout's skills read: the snapshot T3 Code sent, when it was asked for, and its failures in a row. */
type WorkspaceRead = { snapshot?: WorkspaceSnapshot; requestedAt?: number; retryAt?: number; failures: number; pending?: Promise<void> };

/** How long the config subscription outlives its last watcher, so flipping pages doesn't resubscribe. */
export const CONFIG_WATCH_LINGER_MS = 60_000;
type ThreadRef = Pick<ShellRow, "threadId">;

const APPROVAL_HEADING: Record<string, MessageKey> = {
	command: "approval.command",
	"file-read": "approval.fileRead",
	"file-change": "approval.fileChange",
	permission: "approval.permission",
	"mcp-elicitation": "approval.mcpElicitation",
};
/** Approvals the deck answers; others (tool calls, app access, auth) open in T3 Code. */
const ANSWERABLE = new Set(["command", "file-read", "file-change", "permission", "user_input"]);
const DECK_DECISIONS: Decision[] = ["accept", "acceptForSession", "acceptAlways", "decline"];
/** Assumed when a request lists no options; "always" is offered only when the adapter lists it. */
const DEFAULT_DECISIONS: Decision[] = ["accept", "acceptForSession", "decline"];

type TurnItem = {
	type: string;
	requestId?: string;
	prompt?: string;
	reason?: string;
	options?: { decision: Decision }[];
	questions?: Question[];
	responseMode?: "message";
};

/** T3 Code has no accessory source yet; an "accessory" literal will be proposed upstream before this ships. */
export const DECK_CREATION_SOURCE = "mobile";

/** First line of the message, as T3 Code seeds titles (`deriveThreadTitleSeed`). */
export function titleSeed(text: string): string {
	const line = text.trim().split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
	return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line || "New thread";
}

/** One T3 Code environment, reached through its client API: one socket, one shell subscription. */
export class Machine {
	state: MachineState = { kind: "signed-out" };
	#rpc: RpcSocket | undefined;
	#shell: ShellState | undefined;
	#config: ServerConfig | undefined;
	#configLoad: { rpc: RpcSocket; done: Promise<void> } | undefined;
	/** Bumped on every config read, so the deck repaints faces drawn from it. */
	configVersion = 0;
	#rows: ShellRow[] = [];
	/** Every top-level thread by id, settled and snoozed too; built on first use after each change. */
	#everyRow: Map<string, ShellRow> | undefined;
	#subscribed = false;
	#snoozeTimer: ReturnType<typeof setTimeout> | undefined;
	/** Hub accounts' limits, from the config subscription; undefined until it reports them. */
	#limitSources: UsageLimitSourceSnapshot[] | undefined;
	#configWatchers = 0;
	#configWatch: { rpc: RpcSocket; stop: () => void } | undefined;
	#unwatchTimer: ReturnType<typeof setTimeout> | undefined;
	/** Scheduled tasks while something watches them; undefined until the first list. */
	#tasks: ScheduledTask[] | undefined;
	/** Why tasks can't be listed (an older T3 Code), if they can't. */
	#tasksError: string | undefined;
	#taskWatchers = 0;
	#taskWatch: { rpc: RpcSocket; stop: () => void } | undefined;
	#untaskTimer: ReturnType<typeof setTimeout> | undefined;
	/** Bumped when the task list changes, so the deck repaints faces drawn from it. */
	tasksVersion = 0;
	/** Per provider instance and checkout, its skills snapshot: config replies leave these out, so they are read on demand. */
	readonly #workspaces = new Map<string, WorkspaceRead>();
	readonly #now: () => number;
	readonly #uuid: () => string;

	constructor(
		readonly url: string,
		private readonly store: CredentialStore,
		private readonly deps: MachineDeps,
		private readonly onChange: () => void,
	) {
		this.#now = deps.now ?? Date.now;
		this.#uuid = deps.uuid ?? (() => crypto.randomUUID());
	}

	get credential(): Credential | undefined {
		return this.store.load(this.url);
	}

	get environmentId(): string | undefined {
		return this.credential?.environmentId;
	}

	get canOperate(): boolean {
		return this.state.kind === "ready" && this.state.canOperate;
	}

	/** Listed threads, newest derivation; empty until the first snapshot. */
	get rows(): readonly ShellRow[] {
		return this.#rows;
	}

	get projects(): ProjectShell[] {
		return [...(this.#shell?.projects.values() ?? [])];
	}

	/**
	 * One top-level thread, listed or not (settled, snoozed): null once the shell no longer has it (archived or deleted),
	 * undefined while there is no shell yet to tell.
	 */
	threadRow(threadId: string): ShellRow | null | undefined {
		return this.#allRows()?.get(threadId) ?? (this.#shell === undefined ? undefined : null);
	}

	/** Every top-level thread, listed or not, newest first: the choices for a key aimed at one thread. */
	get everyRow(): ShellRow[] {
		return [...(this.#allRows()?.values() ?? [])].sort((a, b) => b.updatedAt - a.updatedAt);
	}

	#allRows(): Map<string, ShellRow> | undefined {
		if (this.#shell === undefined) return undefined;
		this.#everyRow ??= new Map(shellRows(this.#shell, this.#capabilities, this.#now(), true).map((row) => [row.threadId, row]));
		return this.#everyRow;
	}

	project(projectId: string): ProjectShell | undefined {
		return this.#shell?.projects.get(projectId);
	}

	/** The scopes this machine's token was granted at pairing. */
	get scopes(): readonly string[] {
		return this.credential?.scopes ?? [];
	}

	/** Editors T3 Code found on this machine, in its order. */
	get editors(): readonly string[] {
		return this.#config?.availableEditors ?? [];
	}

	/**
	 * One request under `scope`. Without the scope it fails here the way T3 Code would (`requiredPermission`), so
	 * callers handle both alike; T3 Code checks every request anyway.
	 */
	call<T>(tag: string, payload: unknown, scope: string = READ_SCOPE): Promise<T> {
		try {
			return this.#rpcForScope(scope).request<T>(tag, payload);
		} catch (error) {
			return Promise.reject(error);
		}
	}

	/**
	 * A streaming request under `scope`, until it ends. It is never re-sent after a reconnect: a dropped socket
	 * fails it, so a commit or push can't run twice.
	 */
	stream(tag: string, payload: unknown, onValue: (value: unknown) => void, scope: string = READ_SCOPE): Promise<void> {
		let rpc: RpcSocket;
		try {
			rpc = this.#rpcForScope(scope);
		} catch (error) {
			return Promise.reject(error);
		}
		return new Promise((resolve, reject) => {
			rpc.subscribe(tag, () => payload, onValue, { onEnd: (error) => (error === undefined ? resolve() : reject(error)) });
		});
	}

	#rpcForScope(scope: string): RpcSocket {
		const rpc = this.#rpcFor(scope === OPERATE_SCOPE);
		if (scope !== READ_SCOPE && scope !== OPERATE_SCOPE && !this.scopes.includes(scope)) {
			throw new RpcError("EnvironmentAuthorizationError", `This pairing is missing ${scope}.`, undefined, scope);
		}
		return rpc;
	}

	/** True when `projectId` is the "no project" scratch project. */
	isScratch(projectId: string): boolean {
		const root = this.#config?.scratchWorkspaceRoot;
		return root !== undefined && this.#shell?.projects.get(projectId)?.workspaceRoot === root;
	}

	start(): void {
		if (this.#rpc !== undefined) return;
		const credential = this.credential;
		if (credential === undefined) return this.#set({ kind: "signed-out" });
		if (credential.expiresAt <= this.#now()) {
			void this.store.save(this.url, undefined);
			return this.#set({ kind: "signed-out", message: t("machine.pairingExpired") });
		}
		const rpc: RpcSocket = new RpcSocket({
			authorize: () => socketUrl(this.url, credential, this.deps.fetch),
			socket: this.deps.socket,
			random: this.deps.random,
			now: this.#now,
			onState: (state) => {
				if (this.#rpc === rpc) this.#onSocket(state);
			},
			onOpen: () => {
				if (this.#rpc === rpc) void this.#opened(rpc, credential);
			},
		});
		this.#rpc = rpc;
		this.#set({ kind: "connecting" });
		rpc.start();
	}

	stop(): void {
		const rpc = this.#rpc;
		this.#rpc = undefined;
		this.#subscribed = false;
		this.#configWatch = undefined;
		this.#taskWatch = undefined;
		clearTimeout(this.#snoozeTimer);
		rpc?.stop();
	}

	/** Reconnects now instead of waiting out the backoff, or after a fatal stop. */
	wake(): void {
		if (this.#rpc === undefined) return this.start();
		this.#rpc.wake();
	}

	/** Spends a pair link's one-time code. The current connection keeps running if it fails. */
	async pair(code: string, extraScopes: readonly string[] = []): Promise<Credential> {
		const credential = await redeemPairingCode(this.url, code, this.deps.fetch, this.#now(), extraScopes);
		this.stop();
		await this.store.save(this.url, credential);
		this.#reset();
		this.start();
		return credential;
	}

	/** Forgets the token here. T3 Code keeps listing the session until it is revoked in Settings → Sharing & access. */
	async signOut(): Promise<void> {
		this.stop();
		await this.store.save(this.url, undefined);
		this.#reset();
		this.#set({ kind: "signed-out" });
	}

	#reset(): void {
		this.#shell = undefined;
		this.#config = undefined;
		this.#limitSources = undefined;
		this.#tasks = undefined;
		this.#tasksError = undefined;
		this.#configLoad = undefined;
		this.#workspaces.clear();
		this.#rows = [];
		this.#everyRow = undefined;
	}

	#onSocket(state: RpcState): void {
		switch (state.kind) {
			case "connecting":
				if (this.state.kind !== "error") this.#set({ kind: "connecting" });
				return;
			case "retrying":
				// A single drop (a restart, a sleep) is not worth an error row; repeated ones are.
				return this.#set(state.delayMs <= 2_000 ? { kind: "connecting" } : { kind: "error", message: state.error.message });
			case "stopped": {
				const error = state.error;
				if (error === undefined) return;
				this.#rpc = undefined;
				this.#subscribed = false;
				this.#configWatch = undefined;
				this.#taskWatch = undefined;
				if (error instanceof PairingError && error.kind === "repair") {
					void this.store.save(this.url, undefined);
					this.#reset();
					return this.#set({ kind: "signed-out", message: error.message });
				}
				return this.#set({ kind: "error", message: error.message });
			}
		}
	}

	async #opened(rpc: RpcSocket, credential: Credential): Promise<void> {
		// A reconnect resumes the shell on the cached config and re-reads it alongside: favorites may have changed.
		if (this.#config !== undefined) void this.#loadConfig(rpc).catch(() => undefined);
		else {
			try {
				await this.#loadConfig(rpc);
			} catch (error) {
				return rpc.drop(error as Error);
			}
		}
		if (this.#rpc !== rpc || this.#config === undefined) return;
		if (!this.#subscribed) {
			this.#subscribed = true;
			rpc.subscribe("orchestration.subscribeShell", () => this.#shellPayload(), (item) => this.#apply(item as ShellItem), {
				persistent: true,
				onEnd: (error) => this.#shellEnded(rpc, error),
			});
		}
		this.#set({
			kind: "ready",
			environmentId: credential.environmentId,
			label: this.#config.environment?.label ?? credential.label,
			canOperate: credential.scopes.includes(OPERATE_SCOPE),
		});
		this.#syncConfigWatch();
		this.#syncTaskWatch();
		this.#derive();
	}

	/** One `server.getConfig` at a time; callers that arrive while it runs share it. */
	#loadConfig(rpc: RpcSocket): Promise<void> {
		if (this.#configLoad?.rpc === rpc) return this.#configLoad.done;
		const load = {
			rpc,
			done: rpc
				.request<ServerConfig>("server.getConfig", {})
				.then((config) => {
					if (this.#rpc !== rpc) return;
					this.#config = config;
					this.configVersion++;
					this.onChange();
				})
				.finally(() => {
					if (this.#configLoad === load) this.#configLoad = undefined;
				}),
		};
		this.#configLoad = load;
		return load.done;
	}

	/** Re-reads the server config (favorites, providers) now, as when a property inspector opens; a no-op offline. */
	async refreshConfig(): Promise<void> {
		if (this.state.kind !== "ready" || this.#rpc === undefined) return;
		await this.#loadConfig(this.#rpc).catch(() => undefined);
	}

	/** The providers and model preferences `models.ts` builds the catalog from. */
	get modelConfig(): ModelConfig | undefined {
		return this.#config;
	}

	/** Hub accounts' limits; undefined until the config subscription reports them. */
	get limitSources(): readonly UsageLimitSourceSnapshot[] | undefined {
		return this.#limitSources;
	}

	/** The settings a usage summary depends on, as one comparable value. */
	get usageSettingsStamp(): string {
		const { usagePriceOverrides, usageModelAliases, cursorKeychainUsageEnabled } = this.#config?.settings ?? {};
		return JSON.stringify([usagePriceOverrides, usageModelAliases, cursorKeychainUsageEnabled]);
	}

	/**
	 * Keeps the server config live while something shows limits or usage: providers (and their limits), settings and
	 * hub accounts arrive as they change. Returns the release; the subscription lingers a minute after the last one.
	 */
	watchConfig(): () => void {
		this.#configWatchers++;
		clearTimeout(this.#unwatchTimer);
		this.#syncConfigWatch();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#configWatchers--;
			if (this.#configWatchers === 0) this.#unwatchTimer = setTimeout(() => this.#syncConfigWatch(), CONFIG_WATCH_LINGER_MS);
		};
	}

	#syncConfigWatch(): void {
		const rpc = this.state.kind === "ready" ? this.#rpc : undefined;
		const wanted = this.#configWatchers > 0 ? rpc : undefined;
		if (this.#configWatch !== undefined && this.#configWatch.rpc !== wanted) {
			this.#configWatch.stop();
			this.#configWatch = undefined;
		}
		if (wanted === undefined || this.#configWatch !== undefined) return;
		const watch = {
			rpc: wanted,
			stop: wanted.subscribe("subscribeServerConfig", () => ({ workspaceSnapshotsOnDemand: true, usageLimitSources: true }), (event) => this.#onConfigEvent(wanted, event as ConfigEvent), {
				persistent: true,
				// Not retried until the next connection: limits then update on refreshes only.
				onEnd: () => {
					if (this.#configWatch !== watch) return;
					watch.stop();
					this.#configWatch = undefined;
				},
			}),
		};
		this.#configWatch = watch;
	}

	#onConfigEvent(rpc: RpcSocket, event: ConfigEvent): void {
		if (this.#rpc !== rpc) return;
		const { config, payload } = event;
		switch (event.type) {
			case "snapshot":
				if (config === undefined) return;
				this.#config = config;
				break;
			case "usageLimitSourcesUpdated":
				if (!Array.isArray(payload?.sources)) return;
				this.#limitSources = payload.sources;
				break;
			case "providerStatuses":
				if (this.#config === undefined || !Array.isArray(payload?.providers)) return;
				this.#config = { ...this.#config, providers: payload.providers };
				break;
			case "settingsUpdated":
				if (this.#config === undefined || payload?.settings === undefined) return;
				this.#config = { ...this.#config, settings: payload.settings };
				break;
			default:
				return;
		}
		this.configVersion++;
		this.onChange();
	}

	/**
	 * Re-reads every provider's limits and hub account now. Never `refreshModels`, which may open provider sessions;
	 * the reply's providers apply at once, and hub accounts follow on the config subscription.
	 */
	async refreshProviders(): Promise<void> {
		const rpc = this.#rpcFor(false);
		const { providers } = await rpc.request<{ providers?: ConfigProvider[] }>("server.refreshProviders", { workspaceSnapshotsOnDemand: true });
		if (this.#rpc !== rpc || this.#config === undefined || !Array.isArray(providers)) return;
		this.#config = { ...this.#config, providers };
		this.configVersion++;
		this.onChange();
	}

	/** The machine's scheduled tasks, live while watched; undefined until listed. */
	get tasks(): readonly ScheduledTask[] | undefined {
		return this.#tasks;
	}

	get tasksError(): string | undefined {
		return this.#tasksError;
	}

	/** Keeps the task list live (T3 Code resends it whole on every change) while something shows it; returns the release. */
	watchTasks(): () => void {
		this.#taskWatchers++;
		clearTimeout(this.#untaskTimer);
		this.#syncTaskWatch();
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#taskWatchers--;
			if (this.#taskWatchers === 0) this.#untaskTimer = setTimeout(() => this.#syncTaskWatch(), CONFIG_WATCH_LINGER_MS);
		};
	}

	#syncTaskWatch(): void {
		const rpc = this.state.kind === "ready" ? this.#rpc : undefined;
		const wanted = this.#taskWatchers > 0 ? rpc : undefined;
		if (this.#taskWatch !== undefined && this.#taskWatch.rpc !== wanted) {
			this.#taskWatch.stop();
			this.#taskWatch = undefined;
		}
		if (wanted === undefined || this.#taskWatch !== undefined) return;
		const watch = {
			rpc: wanted,
			stop: wanted.subscribe("scheduledTasks.subscribe", () => ({}), (value) => this.#setTasks(wanted, readTasks(value), undefined), {
				persistent: true,
				// An older T3 Code has no tasks; not retried until the next connection.
				onEnd: (error) => {
					if (this.#taskWatch !== watch) return;
					watch.stop();
					this.#taskWatch = undefined;
					if (error !== undefined) this.#setTasks(wanted, this.#tasks, error.message);
				},
			}),
		};
		this.#taskWatch = watch;
	}

	#setTasks(rpc: RpcSocket, tasks: ScheduledTask[] | undefined, error: string | undefined): void {
		if (this.#rpc !== rpc) return;
		this.#tasks = tasks;
		this.#tasksError = error;
		this.tasksVersion++;
		this.onChange();
	}

	/** The task list once, for an inspector's choices while nothing watches it. */
	async listTasks(): Promise<readonly ScheduledTask[]> {
		return this.#tasks ?? readTasks(await this.call("scheduledTasks.list", {}));
	}

	/** Starts a scheduled task now, as T3 Code's Run now does. */
	async runTask(id: string): Promise<void> {
		await this.call("scheduledTasks.runNow", { id }, OPERATE_SCOPE);
	}

	/** Turns a scheduled task on or off. */
	async setTaskEnabled(id: string, enabled: boolean): Promise<void> {
		await this.call("scheduledTasks.setEnabled", { id, enabled }, OPERATE_SCOPE);
	}

	/** Cost and tokens for a window; T3 Code scans its transcript folders for every call, so callers cache. */
	async usageSummary(input: UsageSummaryInput): Promise<UsageSummary> {
		return readUsageSummary(await this.call<unknown>("server.getUsageSummary", input, DIAGNOSTICS_SCOPE));
	}

	/** Reloads model prices from T3 Code's rate table; it doesn't rescan, so read the summary again after. */
	async refreshUsageRates(): Promise<void> {
		await this.call("server.refreshUsageRates", {}, DIAGNOSTICS_SCOPE);
	}

	/**
	 * The skills a thread on `instanceId` working in `cwd` can run, as its composer lists them; `loading` while its
	 * checkout's first read runs. The checkout is read again once T3 Code's snapshot goes stale, so only call this for
	 * a thread a visible face shows.
	 */
	skills(instanceId: string, cwd: string | undefined): { skills: ProviderSkill[]; loading: boolean } {
		const provider = this.#config?.providers?.find((candidate) => candidate.instanceId === instanceId);
		if (provider === undefined || cwd === undefined) return { skills: threadSkills(provider, undefined), loading: false };
		const read = this.#workspaceRead(instanceId, cwd);
		const snapshot = read.snapshot ?? provider.workspaceSnapshots?.find((candidate) => candidate.cwd === cwd);
		return { skills: threadSkills(provider, snapshot), loading: snapshot === undefined && read.pending !== undefined };
	}

	/** The same list once its checkout's read has landed, for an inspector's choices. */
	async readSkills(instanceId: string, cwd: string | undefined): Promise<ProviderSkill[]> {
		if (cwd !== undefined) await this.#workspaceRead(instanceId, cwd).pending;
		return this.skills(instanceId, cwd).skills;
	}

	/** Starts a checkout's read when it has none, or a stale one, unless failures hold it back (`planProviderWorkspaceSnapshotRefresh`). */
	#workspaceRead(instanceId: string, cwd: string): WorkspaceRead {
		const key = `${instanceId}\n${cwd}`;
		const read = this.#workspaces.get(key) ?? { failures: 0 };
		this.#workspaces.set(key, read);
		const now = this.#now();
		const due = read.requestedAt === undefined || now - read.requestedAt >= WORKSPACE_SNAPSHOT_TTL_MS;
		if (read.pending !== undefined || !due || (read.retryAt ?? 0) > now || read.failures >= WORKSPACE_MAX_FAILURES || this.state.kind !== "ready") return read;
		read.requestedAt = now;
		read.pending = this.#rpcFor(false)
			.request<{ providers?: ConfigProvider[] }>("server.refreshProviders", { instanceId, cwd, workspaceSnapshotsOnDemand: true })
			.then(({ providers }) => providers?.find((provider) => provider.instanceId === instanceId)?.workspaceSnapshots?.find((snapshot) => snapshot.cwd === cwd))
			.catch(() => undefined)
			.then((snapshot) => {
				read.pending = undefined;
				if (this.#workspaces.get(key) !== read) return;
				if (snapshot === undefined || snapshot.slashCommandsPending === true) {
					read.failures++;
					read.requestedAt = undefined;
					read.retryAt = this.#now() + WORKSPACE_RETRY_MS;
				} else {
					read.snapshot = snapshot;
					read.failures = 0;
				}
				this.onChange();
			});
		return read;
	}

	/** Spends one banked reset credit on a provider account or hub account. */
	consumeResetCredit(input: ResetCreditInput): Promise<{ outcome: ResetCreditOutcome; warning?: string }> {
		return this.call("provider.consumeResetCredit", input, PROVIDERS_SCOPE);
	}

	/** Resumes from the last applied sequence; the omit flags only go to servers that advertise them. */
	#shellPayload(): Record<string, unknown> {
		const config = this.#config;
		return {
			...(this.#shell !== undefined ? { afterSequence: this.#shell.seq } : {}),
			...(config?.shellResumeCompletionMarker === true ? { requestCompletionMarker: true } : {}),
			...(config?.shellThreadFamilies === true ? { omitIdleSubagents: true, ...(config.shellOlderSettled === true ? { omitOlderSettled: true } : {}) } : {}),
		};
	}

	#shellEnded(rpc: RpcSocket, error: Error | undefined): void {
		if (error instanceof RpcError && error.tag === "EnvironmentAuthorizationError") {
			this.stop();
			return this.#set({ kind: "error", message: t("machine.cannotRead") });
		}
		rpc.drop(error ?? new Error(t("connection.feedEnded")));
	}

	#apply(item: ShellItem): void {
		const next = applyShellItem(this.#shell, item);
		if (next === this.#shell) return;
		this.#shell = next;
		this.#derive();
	}

	#derive(): void {
		clearTimeout(this.#snoozeTimer);
		const shell = this.#shell;
		const now = this.#now();
		this.#rows = shell === undefined ? [] : shellRows(shell, this.#capabilities, now);
		this.#everyRow = undefined;
		const wake = shell === undefined ? undefined : nextSnoozeWake(shell, now);
		// Timers overflow past 2^31 ms; a far-off wake just re-arms.
		if (wake !== undefined) this.#snoozeTimer = setTimeout(() => this.#derive(), Math.min(wake - now + 10, 2 ** 31 - 1));
		this.onChange();
	}

	#set(state: MachineState): void {
		this.state = state;
		this.onChange();
	}

	get #capabilities(): Capabilities {
		return this.#config?.environment?.capabilities ?? {};
	}

	#rpcFor(operate: boolean): RpcSocket {
		if (this.state.kind !== "ready" || this.#rpc === undefined) throw new Error("Not connected to T3 Code.");
		if (operate && !this.state.canOperate) throw new Error("This pairing is read-only.");
		return this.#rpc;
	}

	#require(capability: keyof Capabilities, what: string): void {
		if (this.#capabilities[capability] !== true) throw new Error(`This T3 Code can't ${what}. Update it.`);
	}

	#dispatch(command: Record<string, unknown>): Promise<unknown> {
		return this.#rpcFor(true).request("orchestration.dispatchCommand", { ...command, commandId: this.#uuid() });
	}

	/** `thread.stop` where supported, else interrupts the active run and holds its queue, as T3 Code does. */
	async stopRun(thread: Pick<ShellRow, "threadId" | "activeRunId">): Promise<void> {
		if (this.#capabilities.threadStop === true) return void (await this.#dispatch({ type: "thread.stop", threadId: thread.threadId }));
		if (thread.activeRunId === null) return;
		await this.#dispatch({ type: "run.interrupt", threadId: thread.threadId, runId: thread.activeRunId, holdQueue: true });
	}

	/** The server picks steer, queue or restart for `auto` from the provider's abilities. */
	async send(thread: ThreadRef, text: string, mode: SendMode = "auto", context?: MessageContext): Promise<void> {
		this.#require("serverResolvedCommandContext", "take messages from the deck");
		await this.#dispatch({
			type: "message.dispatch",
			createdBy: "user",
			creationSource: DECK_CREATION_SOURCE,
			threadId: thread.threadId,
			messageId: this.#uuid(),
			text,
			...(context === undefined ? {} : { context }),
			attachments: [],
			...(mode === "queue" ? { dispatchMode: { type: "queue_after_active" } } : { dispatchMode: { type: "start_immediately" }, deliveryIntent: mode }),
		});
	}

	/**
	 * Starts a thread in a project, or in the scratch "no project" project. Model and access follow the
	 * project's override, then the app defaults; `fallbackModel` covers a server with no default model.
	 * An empty `message` starts an empty thread, as T3 Code's new-thread button does.
	 */
	async launch(
		target: { projectId: string } | { scratch: true },
		message: string,
		options: { title?: string; fallbackModel?: ModelSelection; threadId?: string; workspaceStrategy?: WorkspaceStrategy; context?: MessageContext } = {},
	): Promise<{ threadId: string }> {
		const rpc = this.#rpcFor(true);
		let projectId: string;
		if ("scratch" in target) {
			if (this.#config?.scratchWorkspaceRoot === undefined) throw new Error("This T3 Code has no scratch project. Update it.");
			({ projectId } = await rpc.request<{ projectId: string }>("projects.ensureScratch", {}));
		} else projectId = target.projectId;
		const settings = this.#config?.settings;
		const override = settings?.projectSettingsOverrides?.[projectId];
		const modelSelection =
			override?.defaultModelSelection ??
			settings?.defaultModelSelection ??
			this.#shell?.projects.get(projectId)?.defaultModelSelection ??
			options.fallbackModel ??
			this.#firstDefaultModel();
		if (modelSelection === undefined) throw new Error("Pick a default model in T3 Code first.");
		const threadId = options.threadId ?? this.#uuid();
		const title = options.title?.trim();
		const text = message.trim();
		await rpc.request("orchestration.launchThread", {
			commandId: this.#uuid(),
			creationSource: DECK_CREATION_SOURCE,
			threadId,
			projectId,
			title: title || titleSeed(text),
			generateTitle: !title && text !== "",
			modelSelection,
			runtimeMode: override?.defaultRuntimeMode ?? settings?.defaultRuntimeMode ?? "full-access",
			interactionMode: "default",
			workspaceStrategy: options.workspaceStrategy ?? { type: "root" },
			...(text === "" ? {} : { initialMessage: { messageId: this.#uuid(), text: message, ...(options.context === undefined ? {} : { context: options.context }), attachments: [] } }),
		});
		return { threadId };
	}

	/**
	 * Where a new worktree for `projectId` starts, as T3 Code's composer launches one: from the repository's default
	 * branch, under a branch name the server picks, from origin when the project's setting says so.
	 */
	async worktreeStrategy(projectId: string): Promise<WorkspaceStrategy> {
		const root = this.#shell?.projects.get(projectId)?.workspaceRoot;
		if (root === undefined) throw new RpcError("NoProject", "The project is gone.", t("worktree.noProject"));
		const listed = await this.call<{ isRepo?: boolean; refs?: VcsRef[] }>("vcs.listRefs", { cwd: root, limit: 100 });
		const baseRef = listed.isRepo === false ? undefined : worktreeBase(listed.refs ?? []);
		if (baseRef === undefined) throw new RpcError("NoBaseRef", "No branch to start a worktree from.", t(listed.isRepo === false ? "worktree.notRepo" : "worktree.noBranch"));
		const settings = this.#config?.settings;
		const fromOrigin = settings?.projectSettingsOverrides?.[projectId]?.newWorktreesStartFromOrigin ?? settings?.newWorktreesStartFromOrigin ?? true;
		return { type: "worktree", baseRef, ...(fromOrigin ? { startFromOrigin: true } : {}) };
	}

	#firstDefaultModel(): ModelSelection | undefined {
		for (const provider of this.#config?.providers ?? []) {
			if (provider.enabled === false) continue;
			const model = provider.models.find((candidate) => candidate.isDefault) ?? provider.models[0];
			if (model !== undefined) return { instanceId: provider.instanceId, model: model.slug };
		}
		return undefined;
	}

	async setModelSelection(thread: ThreadRef, modelSelection: ModelSelection): Promise<unknown> {
		return this.#dispatch({ type: "thread.model-selection.set", threadId: thread.threadId, modelSelection });
	}

	async setRuntimeMode(thread: ThreadRef, runtimeMode: RuntimeMode): Promise<unknown> {
		return this.#dispatch({ type: "thread.runtime-mode.set", threadId: thread.threadId, runtimeMode });
	}

	async setInteractionMode(thread: ThreadRef, interactionMode: InteractionMode): Promise<unknown> {
		return this.#dispatch({ type: "thread.interaction-mode.set", threadId: thread.threadId, interactionMode });
	}

	/**
	 * Marks the thread read up to its current row, as T3 Code's visit tracker does; `opened` also stamps the open
	 * that the deck's selection follows. Every visit is broadcast to all clients, so callers send it only for an
	 * explicit selection.
	 */
	async visit(thread: ThreadRef, options: { opened?: boolean } = {}): Promise<void> {
		const visitedAt = this.#shell?.threads.get(thread.threadId)?.updatedAt;
		if (visitedAt === undefined || !this.canOperate || this.#capabilities.threadVisitedTracking !== true) return;
		await this.#dispatch({ type: "thread.visit", threadId: thread.threadId, visitedAt, ...(options.opened ? { opened: true } : {}) });
	}

	async markUnread(thread: ThreadRef): Promise<unknown> {
		this.#require("threadVisitedTracking", "mark threads unread");
		return this.#dispatch({ type: "thread.mark-unread", threadId: thread.threadId });
	}

	async settle(thread: ThreadRef): Promise<unknown> {
		this.#require("threadSettlement", "settle threads");
		return this.#dispatch({ type: "thread.settle", threadId: thread.threadId });
	}

	async unsettle(thread: ThreadRef): Promise<unknown> {
		this.#require("threadSettlement", "settle threads");
		return this.#dispatch({ type: "thread.unsettle", threadId: thread.threadId, reason: "user" });
	}

	async pin(thread: ThreadRef): Promise<unknown> {
		this.#require("threadPinning", "pin threads");
		return this.#dispatch({ type: "thread.pin", threadId: thread.threadId });
	}

	async unpin(thread: ThreadRef): Promise<unknown> {
		this.#require("threadPinning", "pin threads");
		return this.#dispatch({ type: "thread.unpin", threadId: thread.threadId });
	}

	async snooze(thread: ThreadRef, minutes: number): Promise<unknown> {
		this.#require("threadSnooze", "snooze threads");
		const snoozedUntil = new Date(this.#now() + Math.max(1, minutes) * 60_000).toISOString();
		return this.#dispatch({ type: "thread.snooze", threadId: thread.threadId, snoozedUntil });
	}

	async unsnooze(thread: ThreadRef): Promise<unknown> {
		this.#require("threadSnooze", "snooze threads");
		return this.#dispatch({ type: "thread.unsnooze", threadId: thread.threadId, reason: "user" });
	}

	async archive(thread: ThreadRef): Promise<unknown> {
		return this.#dispatch({ type: "thread.archive", threadId: thread.threadId });
	}

	/**
	 * Details for the thread's blocking request. Approvals are one `getTurnItem` away (adapters derive the
	 * item id from the request id); otherwise one bounded thread snapshot, never the full transcript.
	 */
	async pendingRequest(thread: Pick<ShellRow, "pendingRequest">): Promise<PendingRequest | undefined> {
		const pending = thread.pendingRequest;
		if (pending === undefined) return undefined;
		const base = { threadId: pending.threadId, requestId: pending.id };
		const heading = t(APPROVAL_HEADING[pending.kind] ?? "approval.needsYou");
		if (!ANSWERABLE.has(pending.kind)) return { type: "unsupported", ...base, heading };
		const rpc = this.#rpcFor(false);
		const { item } = await rpc.request<{ item: TurnItem | null }>("orchestration.getTurnItem", {
			threadId: pending.threadId,
			itemId: `turn-item:runtime-request:${encodeURIComponent(pending.id)}`,
		});
		const found = item?.requestId === pending.id ? { item, live: true } : await this.#fromThreadSnapshot(rpc, pending.threadId, pending.id);
		if (found?.item == null || !found.live) return { type: "unsupported", ...base, heading };
		if (found.item.type === "user_input_request") {
			return { type: "question", ...base, questions: found.item.questions ?? [], messageMode: found.item.responseMode === "message" };
		}
		if (found.item.type !== "approval_request") return { type: "unsupported", ...base, heading };
		const offered = found.item.options?.map((option) => option.decision);
		const decisions = offered === undefined ? DEFAULT_DECISIONS : DECK_DECISIONS.filter((decision) => offered.includes(decision));
		return {
			type: "approval",
			...base,
			heading,
			summary: found.item.prompt?.trim() || found.item.reason?.trim() || heading,
			decisions: decisions.length > 0 ? decisions : DEFAULT_DECISIONS,
		};
	}

	/** Takes the first bounded snapshot of a thread and unsubscribes. `live` is false when the provider can't take an answer. */
	async #fromThreadSnapshot(rpc: RpcSocket, threadId: string, requestId: string): Promise<{ item: TurnItem | undefined; live: boolean } | undefined> {
		const projection = (await this.#threadSnapshot(rpc, threadId)) as { turnItems?: TurnItem[]; runtimeRequests?: { id: string; responseCapability?: { type?: string } }[] } | undefined;
		if (projection === undefined) return undefined;
		const item = projection.turnItems?.findLast((candidate) => candidate.requestId === requestId);
		const capability = projection.runtimeRequests?.find((request) => request.id === requestId)?.responseCapability?.type;
		return { item, live: capability !== "not_resumable" };
	}

	/** One bounded thread snapshot: the latest window plus every queued run and its message (threadHistoryPaging.ts). */
	#threadSnapshot(rpc: RpcSocket, threadId: string): Promise<unknown> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = (result: unknown) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				unsubscribe();
				resolve(result);
			};
			const timer = setTimeout(() => finish(undefined), 10_000);
			const unsubscribe = rpc.subscribe(
				"orchestration.subscribeThread",
				() => ({ threadId, acceptBoundedSnapshot: true }),
				(value) => {
					const snapshot = value as { kind?: string; projection?: unknown };
					if (snapshot.kind === "snapshot") finish(snapshot.projection);
				},
				{ onEnd: () => finish(undefined) },
			);
		});
	}

	/** The thread's queue, read from one bounded snapshot; T3 Code's shell carries no queue, so callers read it on change. */
	async queue(thread: ThreadRef): Promise<ThreadQueue> {
		const projection = await this.#threadSnapshot(this.#rpcFor(false), thread.threadId);
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		return threadQueue(projection as QueueProjection);
	}

	/**
	 * Forks the thread from its newest finished run into a new thread, as T3 Code's fork button on the latest reply
	 * does; the fork's id is chosen here so the caller can open it.
	 */
	async fork(thread: ThreadRef & { title: string }): Promise<{ threadId: string }> {
		const projection = (await this.#threadSnapshot(this.#rpcFor(true), thread.threadId)) as { runs?: ProjectedRun[] } | undefined;
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		const run = forkSourceRun(projection.runs ?? []);
		if (run === undefined) throw new RpcError("NothingToFork", "No finished run to fork from.", t("lineage.nothingToFork"));
		const threadId = this.#uuid();
		await this.#dispatch({
			type: "thread.fork",
			createdBy: "user",
			creationSource: DECK_CREATION_SOURCE,
			sourceThreadId: thread.threadId,
			targetThreadId: threadId,
			sourcePoint: { type: "run", runId: run.id },
			title: forkTitle(thread.title),
		});
		return { threadId };
	}

	/** Merges a fork back into the thread it came from, from its latest finished run, as T3 Code's Merge does. */
	async mergeBack(thread: ThreadRef, into: string): Promise<void> {
		const projection = (await this.#threadSnapshot(this.#rpcFor(true), thread.threadId)) as { runs?: ProjectedRun[] } | undefined;
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		const run = latestMergeBackRun(projection.runs ?? []);
		if (run === undefined) throw new RpcError("NothingToMerge", "No finished run to merge back.", t("lineage.finishRunFirst"));
		await this.#dispatch({
			type: "thread.merge_back",
			createdBy: "user",
			creationSource: DECK_CREATION_SOURCE,
			sourceThreadId: thread.threadId,
			targetThreadId: into,
			sourcePoint: { type: "run", runId: run.id },
		});
	}

	/** The thread's running workflows, from one bounded snapshot: the shell doesn't carry them. */
	async workflows(thread: ThreadRef): Promise<RunningWorkflow[]> {
		const projection = await this.#threadSnapshot(this.#rpcFor(false), thread.threadId);
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		return runningWorkflows(projection as { subagents?: ProjectedSubagent[] });
	}

	/** Stops one workflow the thread runs, as T3 Code's Lineage panel does; its refusal reads as T3 Code words it. */
	async stopWorkflow(thread: ThreadRef, subagentId: string): Promise<void> {
		try {
			await this.call("orchestration.stopWorkflow", { threadId: thread.threadId, subagentId }, OPERATE_SCOPE);
		} catch (error) {
			const reason = error instanceof RpcError ? stopWorkflowFailure(error.code) : undefined;
			if (reason === undefined) throw error;
			throw new RpcError((error as RpcError).tag, (error as RpcError).message, reason);
		}
	}

	/** Steers the running turn with a queued message (T3 Code's "Steer now"). */
	async promoteQueued(thread: ThreadRef, queuedRunId: string, targetRunId: string): Promise<void> {
		await this.#dispatch({ type: "queued-message.promote-to-steer", threadId: thread.threadId, queuedRunId, targetRunId });
	}

	/** Starts a queued message now while nothing runs, which also releases a held queue ("Send now"). */
	async startQueued(thread: ThreadRef, runId: string): Promise<void> {
		await this.#dispatch({ type: "queued-run.start", threadId: thread.threadId, runId });
	}

	/** Removes a queued message. */
	async cancelQueued(thread: ThreadRef, runId: string): Promise<void> {
		await this.#dispatch({ type: "queued-run.cancel", threadId: thread.threadId, runId });
	}

	async respond(threadId: string, requestId: string, decision: Decision): Promise<void> {
		await this.#dispatch({ type: "runtime-request.respond", threadId, requestId, decision });
	}

	async answer(threadId: string, requestId: string, answers: Record<string, string | string[]>): Promise<void> {
		await this.#dispatch({ type: "runtime-request.respond", threadId, requestId, answers });
	}

	/** Providers and their models' options from the cached server config, without prompt-injected values. */
	/** Cheapest diff there is: the open pull request's totals from the shell row. */
	turnDiff(thread: Pick<ShellRow, "pullRequests">): { additions: number; deletions: number } | undefined {
		const open = thread.pullRequests.find((link) => link.state === "open" && (link.additions ?? 0) + (link.deletions ?? 0) > 0);
		return open === undefined ? undefined : { additions: open.additions ?? 0, deletions: open.deletions ?? 0 };
	}
}
