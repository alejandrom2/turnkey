import { t } from "../i18n.js";
import type { ConfigProvider, ModelConfig, ModelPreferences } from "../models.js";
import { readUsageSummary, type ResetCreditInput, type ResetCreditOutcome, type UsageLimitSourceSnapshot, type UsageSummary, type UsageSummaryInput } from "../usage/types.js";
import { type GuestShare, readGuestShare } from "../share.js";
import { applyTerminalEvent, INTERRUPT_INPUT, type ScriptSettings, scriptInput, type TerminalSummary } from "../scripts.js";
import { progressStage, type UpdateEnvironment, type UpdateStage, updateRoute } from "../update.js";
import {
	ACCESS_SCOPE,
	type Credential,
	DIAGNOSTICS_SCOPE,
	MAINTAIN_SCOPE,
	OPERATE_SCOPE,
	PairingError,
	PROVIDERS_SCOPE,
	READ_SCOPE,
	redeemPairingCode,
	socketUrl,
	TERMINAL_READ_SCOPE,
	TERMINAL_SCOPE,
} from "./pairing.js";
import { type VcsRef, worktreeBase } from "../git.js";
import { forkSourceRun, forkTitle, latestMergeBackRun, type ProjectedRun, type ProjectedTurnItem } from "../lineage.js";
import { type ProviderSkill, threadSkills } from "../skills.js";
import { type HtmlRender, latestHtmlRender, type RenderItem } from "../preview.js";
import { readTasks, type ScheduledTask } from "../tasks.js";
import { type ProjectedSubagent, type RunningWorkflow, runningWorkflows, stopWorkflowFailure } from "../workflows.js";
import { LiveWatches } from "./live.js";
import { type QueueProjection, type ThreadQueue, threadQueue } from "./queue.js";
import { type Decision, isAnswerable, type PendingRequest, readPendingRequest, requestInSnapshot, type TurnItem } from "./requests.js";
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
import { threadSnapshot } from "./snapshot.js";
import { PROVIDERS_TIMEOUT_MS, WorkspaceReads } from "./workspaces.js";

export type { Decision, PendingRequest, Question } from "./requests.js";

export type MachineState =
	| { kind: "signed-out"; message?: string }
	| { kind: "connecting" }
	| { kind: "ready"; environmentId: string; label: string; canOperate: boolean }
	| { kind: "error"; message: string };

export interface CredentialStore {
	load(url: string): Credential | undefined;
	save(url: string, credential: Credential | undefined): Promise<void>;
	urls(): readonly string[];
}

/** Everything that touches the outside world, injected so tests never reach a real server. */
type MachineDeps = {
	fetch: typeof fetch;
	socket: SocketFactory;
	/** Which Turnkey this is, as T3 Code lists its pairings: "Turnkey (Stream Deck)", "Turnkey (Logitech)". */
	clientLabel: string;
	/** Where the connection reports frames it couldn't handle. */
	warn?: (message: string) => void;
	now?: () => number;
	random?: () => number;
	uuid?: () => string;
};

type Capabilities = ThreadCapabilities &
	NonNullable<UpdateEnvironment["capabilities"]> & {
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
	environment?: { label?: string; serverVersion?: string; capabilities?: Capabilities };
	providers?: ConfigProvider[];
	settings?: ProjectDefaults &
		ModelPreferences &
		UsageSettings &
		Omit<ScriptSettings, "projectSettingsOverrides"> & {
			projectSettingsOverrides?: Record<string, ProjectDefaults & NonNullable<ScriptSettings["projectSettingsOverrides"]>[string]>;
			/** Settings › Labs › Guest links; the server refuses links while it is off. */
			guestSharingEnabled?: boolean;
			continueThreadsAfterServerUpdate?: boolean;
		};
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
type WorkspaceStrategy =
	| { type: "root"; branch?: string }
	| { type: "existing_worktree"; worktreePath: string; branch?: string }
	| { type: "worktree"; baseRef: string; branch?: string; startFromOrigin?: boolean };

export type SendMode = "auto" | "queue" | "steer" | "restart";

/** A `subscribeServerConfig` event, the parts the deck reads (packages/contracts/src/server.ts). */
type ConfigEvent = {
	type?: string;
	config?: ServerConfig;
	payload?: { providers?: ConfigProvider[]; settings?: ServerConfig["settings"]; sources?: UsageLimitSourceSnapshot[] };
};

/** A connection whose server never answers its first config read is dropped and retried. */
const CONFIG_TIMEOUT_MS = 15_000;
type ThreadRef = Pick<ShellRow, "threadId">;

/** T3 Code has no accessory source yet; an "accessory" literal will be proposed upstream before this ships. */
const DECK_CREATION_SOURCE = "mobile";

/** First line of the message, as T3 Code seeds titles (`deriveThreadTitleSeed`). */
export function titleSeed(text: string): string {
	const line = text.trim().split("\n")[0]?.replace(/\s+/g, " ").trim() ?? "";
	return line.length > 80 ? `${line.slice(0, 79).trimEnd()}…` : line || "New thread";
}

/** One T3 Code environment, reached through its client API: one socket, one shell subscription. */
/** A machine's name: its label once connected, else the pairing's, else its host. */
export const machineName = (machine: Machine): string =>
	machine.state.kind === "ready" ? machine.state.label : machine.credential?.label || new URL(machine.url).host;

export class Machine {
	state: MachineState = { kind: "signed-out" };
	#rpc: RpcSocket | undefined;
	#shell: ShellState | undefined;
	#config: ServerConfig | undefined;
	#configLoad: { rpc: RpcSocket; done: Promise<void> } | undefined;
	/** Bumped on every config read, so the deck repaints faces drawn from it. */
	configVersion = 0;
	#rows: ShellRow[] = [];
	/** The shell changed since `#rows` was built: rebuilt once per streamed batch, or on the next read. */
	#stale = false;
	/** Every top-level thread by id, settled and snoozed too; built on first use after each change. */
	#everyRow: Map<string, ShellRow> | undefined;
	#subscribed = false;
	#snoozeTimer: ReturnType<typeof setTimeout> | undefined;
	/** Hub accounts' limits, from the config subscription; undefined until it reports them. */
	#limitSources: UsageLimitSourceSnapshot[] | undefined;
	/** Scheduled tasks while something watches them; undefined until the first list. */
	#tasks: ScheduledTask[] | undefined;
	/** Why tasks can't be listed (an older T3 Code), if they can't. */
	#tasksError: string | undefined;
	/** Bumped when the task list changes, so the deck repaints faces drawn from it. */
	tasksVersion = 0;
	/** Streams the deck holds open, on the ready connection when the pairing has their scope. */
	readonly #live = new LiveWatches((scope) => (scope === undefined || this.scopes.includes(scope) ? this.#readyRpc : undefined));
	/** This machine's terminals while something watches them; undefined until the first snapshot. */
	#terminals: ReadonlyMap<string, TerminalSummary> | undefined;
	/** Bumped when a terminal changes, so the deck repaints faces drawn from them. */
	terminalsVersion = 0;
	readonly #workspaces: WorkspaceReads;
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
		this.#workspaces = new WorkspaceReads(this.#now, () => this.onChange());
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
		if (this.#stale) this.#rebuild();
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
			this.#forgetPairing();
			return this.#set({ kind: "signed-out", message: t("machine.pairingExpired") });
		}
		const rpc: RpcSocket = new RpcSocket({
			authorize: () => socketUrl(this.url, credential, this.deps.fetch),
			socket: this.deps.socket,
			random: this.deps.random,
			now: this.#now,
			warn: this.deps.warn,
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
		clearTimeout(this.#snoozeTimer);
		rpc?.stop();
		this.#live.sync();
	}

	/** Reconnects now instead of waiting out the backoff, or after a fatal stop. */
	wake(): void {
		if (this.#rpc === undefined) return this.start();
		this.#rpc.wake();
	}

	/** Spends a pair link's one-time code. The current connection keeps running if it fails. */
	async pair(code: string, extraScopes: readonly string[] = []): Promise<Credential> {
		const credential = await redeemPairingCode(this.url, code, this.deps.fetch, this.#now(), extraScopes, this.deps.clientLabel);
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
		this.#terminals = undefined;
		this.#configLoad = undefined;
		this.#workspaces.clear();
		this.#rows = [];
		this.#stale = false;
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
				if (error instanceof PairingError && error.kind === "repair") {
					this.#forgetPairing();
					this.#reset();
					return this.#set({ kind: "signed-out", message: error.message });
				}
				return this.#set({ kind: "error", message: error.message });
			}
		}
	}

	/** Unawaited, so a disk error is reported here rather than becoming an unhandled rejection in the host. */
	#forgetPairing(): void {
		void this.store.save(this.url, undefined).catch((error: unknown) => this.deps.warn?.(`Couldn't forget the pairing: ${error instanceof Error ? error.message : String(error)}`));
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
		this.#derive();
	}

	/** One `server.getConfig` at a time; callers that arrive while it runs share it. */
	#loadConfig(rpc: RpcSocket): Promise<void> {
		if (this.#configLoad?.rpc === rpc) return this.#configLoad.done;
		const load = {
			rpc,
			done: rpc
				.request<ServerConfig>("server.getConfig", {}, CONFIG_TIMEOUT_MS)
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
	readonly watchConfig = this.#live.shared({
		tag: "subscribeServerConfig",
		payload: { workspaceSnapshotsOnDemand: true, usageLimitSources: true },
		onValue: (event) => this.#onConfigEvent(event as ConfigEvent),
	});

	#onConfigEvent(event: ConfigEvent): void {
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
		const { providers } = await rpc.request<{ providers?: ConfigProvider[] }>("server.refreshProviders", { workspaceSnapshotsOnDemand: true }, PROVIDERS_TIMEOUT_MS);
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
	readonly watchTasks = this.#live.shared({
		tag: "scheduledTasks.subscribe",
		payload: {},
		onValue: (value) => this.#setTasks(readTasks(value), undefined),
		// An older T3 Code has no tasks.
		onEnd: (error) => {
			if (error !== undefined) this.#setTasks(this.#tasks, error.message);
		},
	});

	#setTasks(tasks: ScheduledTask[] | undefined, error: string | undefined): void {
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

	/** The terminals of every thread, live while watched; undefined until listed or without terminal status access. */
	get terminals(): ReadonlyMap<string, TerminalSummary> | undefined {
		return this.#terminals;
	}

	/** Keeps terminal states live while something shows a script; returns the release. Needs `terminal:read`. */
	readonly watchTerminals = this.#live.shared({
		tag: "subscribeTerminalMetadata",
		payload: {},
		scope: TERMINAL_READ_SCOPE,
		onValue: (event) => {
			const next = applyTerminalEvent(this.#terminals ?? new Map(), event);
			if (next === this.#terminals) return;
			this.#terminals = next;
			this.terminalsVersion++;
			this.onChange();
		},
	});

	/** Opens the thread's terminal `terminalId` where T3 Code's script runner would, and types the command into it. */
	async runScript(threadId: string, terminalId: string, launch: { cwd: string; worktreePath: string | null; env: Record<string, string> }, command: string): Promise<void> {
		await this.call("terminal.open", { threadId, terminalId, ...launch }, TERMINAL_SCOPE);
		await this.call("terminal.write", { threadId, terminalId, data: scriptInput(command) }, TERMINAL_SCOPE);
	}

	/** Interrupts what runs in the terminal, leaving its shell open. */
	async interruptScript(threadId: string, terminalId: string): Promise<void> {
		await this.call("terminal.write", { threadId, terminalId, data: INTERRUPT_INPUT }, TERMINAL_SCOPE);
	}

	/** The server's version and how it updates itself. */
	get updateEnvironment(): UpdateEnvironment | undefined {
		return this.#config?.environment;
	}

	/** The settings that decide a project's scripts. */
	get scriptSettings(): ScriptSettings | undefined {
		return this.#config?.settings;
	}

	/** Whether Settings › Labs › Guest links is on; absent on servers without guest links. */
	get guestLinksEnabled(): boolean {
		return this.#config?.settings?.guestSharingEnabled === true;
	}

	/**
	 * Updates T3 Code to `targetVersion` as its Update action does, reporting stages; resolves with the version it
	 * restarts on. A socket that drops once the server took the update is its restart, not a failure.
	 */
	async updateServer(targetVersion: string, onStage: (stage: UpdateStage) => void): Promise<string> {
		const environment = this.#config?.environment;
		const route = updateRoute(environment);
		if (route.kind === "manual") throw new RpcError("ManualUpdate", "This T3 Code can't update itself.", t(route.reason));
		const continues = environment?.capabilities?.serverUpdateThreadContinuation === true && this.#config?.settings?.continueThreadsAfterServerUpdate === true;
		const input = { targetVersion, ...(continues ? { continueRunningThreads: true } : {}) };
		let result: { targetVersion?: string; method?: string; desktopUpdateToken?: string } | undefined;
		try {
			if (route.progress) {
				await this.stream(
					"server.updateServerWithProgress",
					input,
					(value) => {
						const event = value as { type?: string; stage?: unknown; result?: typeof result };
						if (event.type === "complete") result = event.result;
						const stage = progressStage(event.stage);
						if (stage !== undefined) onStage(stage);
					},
					MAINTAIN_SCOPE,
				);
			} else result = await this.call("server.updateServer", input, MAINTAIN_SCOPE);
		} catch (error) {
			const handoff = error instanceof RpcError && (error.tag === "Disconnected" || error.tag === "Interrupt");
			// Only a service without progress events hands off by dropping before it answers (`isLegacyUpdateHandoffLoss`).
			if (!handoff || (result === undefined && (route.progress || route.kind !== "service"))) throw error;
		}
		if (result?.method === "desktop-app" && result.desktopUpdateToken !== undefined) {
			onStage("installing");
			try {
				await this.call("server.commitDesktopUpdate", { requestId: result.desktopUpdateToken }, MAINTAIN_SCOPE);
			} catch (error) {
				// The commit relaunches the app, so its socket dropping is the install starting.
				if (!(error instanceof RpcError && (error.tag === "Disconnected" || error.tag === "Interrupt"))) throw error;
			}
		}
		return result?.targetVersion ?? targetVersion;
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
		const read = this.#workspaces.read(instanceId, cwd, this.#readyRpc);
		const snapshot = read.snapshot ?? provider.workspaceSnapshots?.find((candidate) => candidate.cwd === cwd);
		return { skills: threadSkills(provider, snapshot), loading: snapshot === undefined && read.pending !== undefined };
	}

	/** The same list once its checkout's read has landed, for an inspector's choices. */
	async readSkills(instanceId: string, cwd: string | undefined): Promise<ProviderSkill[]> {
		if (cwd !== undefined) await this.#workspaces.read(instanceId, cwd, this.#readyRpc).pending;
		return this.skills(instanceId, cwd).skills;
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

	/** A snapshot or a burst of updates arrives as many items in one frame: the rows are rebuilt once after it. */
	#apply(item: ShellItem): void {
		const next = applyShellItem(this.#shell, item);
		if (next === this.#shell) return;
		this.#shell = next;
		this.#everyRow = undefined;
		if (this.#stale) return;
		this.#stale = true;
		queueMicrotask(() => {
			if (this.#stale) this.#rebuild();
			this.onChange();
		});
	}

	#derive(): void {
		this.#rebuild();
		this.onChange();
	}

	#rebuild(): void {
		this.#stale = false;
		clearTimeout(this.#snoozeTimer);
		const shell = this.#shell;
		const now = this.#now();
		this.#rows = shell === undefined ? [] : shellRows(shell, this.#capabilities, now);
		this.#everyRow = undefined;
		const wake = shell === undefined ? undefined : nextSnoozeWake(shell, now);
		// Timers overflow past 2^31 ms; a far-off wake just re-arms.
		if (wake !== undefined) this.#snoozeTimer = setTimeout(() => this.#derive(), Math.min(wake - now + 10, 2 ** 31 - 1));
	}

	/** False until the first connection attempt ends either way: until then faces show skeletons, not "Connecting". */
	settled = false;

	#set(state: MachineState): void {
		this.state = state;
		if (state.kind !== "connecting") this.settled = true;
		this.#live.sync();
		this.onChange();
	}

	/**
	 * Keeps a stream open while held: on the current connection, again on the next one (`onOpen` runs first, so the
	 * holder can drop what it cached), never while offline. A stream T3 Code ends waits for the next connection.
	 */
	live(tag: string, payload: unknown, onValue: (value: unknown) => void, onOpen?: () => void): () => void {
		return this.#live.hold({ tag, payload, onValue, onOpen });
	}

	get #readyRpc(): RpcSocket | undefined {
		return this.state.kind === "ready" ? this.#rpc : undefined;
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
		// A bad setting would make `toISOString` throw; a year is the longest snooze worth sending.
		const span = Number.isFinite(minutes) ? Math.min(Math.max(1, minutes), 525_600) : 60;
		const snoozedUntil = new Date(this.#now() + span * 60_000).toISOString();
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
		if (!isAnswerable(pending.kind)) return readPendingRequest(pending, undefined);
		const rpc = this.#rpcFor(false);
		const { item } = await rpc.request<{ item: TurnItem | null }>("orchestration.getTurnItem", {
			threadId: pending.threadId,
			itemId: `turn-item:runtime-request:${encodeURIComponent(pending.id)}`,
		});
		const found = item?.requestId === pending.id ? { item, live: true } : requestInSnapshot(await threadSnapshot(rpc, pending.threadId), pending.id);
		return readPendingRequest(pending, found);
	}

	/** The thread's queue, read from one bounded snapshot; T3 Code's shell carries no queue, so callers read it on change. */
	async queue(thread: ThreadRef): Promise<ThreadQueue> {
		const projection = await threadSnapshot(this.#rpcFor(false), thread.threadId);
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		return threadQueue(projection as QueueProjection);
	}

	/**
	 * Forks the thread from its newest finished reply into a new thread, as T3 Code's fork button on that reply
	 * does; the fork's id is chosen here so the caller can open it.
	 */
	async fork(thread: ThreadRef & { title: string }): Promise<{ threadId: string }> {
		const projection = (await threadSnapshot(this.#rpcFor(true), thread.threadId)) as { runs?: ProjectedRun[]; turnItems?: ProjectedTurnItem[] } | undefined;
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		const run = forkSourceRun(projection.runs ?? [], projection.turnItems ?? []);
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
		const projection = (await threadSnapshot(this.#rpcFor(true), thread.threadId)) as { runs?: ProjectedRun[] } | undefined;
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

	/** The thread's newest HTML render, from one bounded snapshot, reading its tool output by id when the snapshot left it out. */
	async htmlRender(thread: ThreadRef): Promise<HtmlRender | undefined> {
		const rpc = this.#rpcFor(false);
		const projection = (await threadSnapshot(rpc, thread.threadId)) as { turnItems?: RenderItem[] } | undefined;
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		const found = latestHtmlRender(projection.turnItems ?? []);
		if (found === undefined || !("omitted" in found)) return found;
		const { item } = await rpc.request<{ item: RenderItem | null }>("orchestration.getTurnItem", { threadId: thread.threadId, itemId: found.itemId });
		const read = item === null ? undefined : latestHtmlRender([item]);
		return read === undefined || "omitted" in read ? undefined : read;
	}

	/** A signed link to one of the machine's files (`assets.createUrl`), resolved against its address as T3 Code's clients do. */
	async assetUrl(resource: Record<string, unknown>): Promise<string> {
		const { relativeUrl } = await this.call<{ relativeUrl: string }>("assets.createUrl", { resource });
		const url = new URL(relativeUrl, this.url);
		// Opened in the browser as the machine's own file, so it may not point anywhere else.
		if (url.origin !== new URL(this.url).origin) throw new RpcError("ForeignAsset", "T3 Code sent a link to another site.", t("connection.foreignLink"));
		return url.href;
	}

	/** The thread's running workflows, from one bounded snapshot: the shell doesn't carry them. */
	async workflows(thread: ThreadRef): Promise<RunningWorkflow[]> {
		const projection = await threadSnapshot(this.#rpcFor(false), thread.threadId);
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

	/** The thread's guest share, from one bounded snapshot: the shell doesn't carry it. */
	async guestShare(thread: ThreadRef): Promise<GuestShare | null> {
		const projection = await threadSnapshot(this.#rpcFor(false), thread.threadId);
		if (projection === undefined) throw new Error("T3 Code didn't send the thread.");
		return readGuestShare(projection);
	}

	/** Makes a guest link for the thread, as Share with guest does; a new link ends the current one. Never log the URL. */
	async createGuestLink(thread: ThreadRef): Promise<{ url: string; share: GuestShare | null }> {
		const { url, share } = await this.call<{ url: string; share: unknown }>("guestShare.create", { threadId: thread.threadId }, ACCESS_SCOPE);
		return { url, share: readGuestShare({ thread: { guestShare: share } }) };
	}

	/** Ends the thread's guest link, as Stop sharing does. */
	async closeGuestLink(thread: ThreadRef): Promise<void> {
		await this.#dispatch({ type: "thread.guest-share.close", threadId: thread.threadId });
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

	/** Cheapest diff there is: the open pull request's totals from the shell row. */
	turnDiff(thread: Pick<ShellRow, "pullRequests">): { additions: number; deletions: number } | undefined {
		const open = thread.pullRequests.find((link) => link.state === "open" && (link.additions ?? 0) + (link.deletions ?? 0) > 0);
		return open === undefined ? undefined : { additions: open.additions ?? 0, deletions: open.deletions ?? 0 };
	}
}
