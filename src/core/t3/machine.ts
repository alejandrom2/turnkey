import { type Credential, OPERATE_SCOPE, PairingError, redeemPairingCode, socketUrl } from "./pairing.js";
import { RpcError, RpcSocket, type RpcState, type SocketFactory } from "./rpc.js";
import {
	applyShellItem,
	type InteractionMode,
	type ModelSelection,
	nextSnoozeWake,
	type OptionValue,
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

type ProjectDefaults = { defaultModelSelection?: ModelSelection | null; defaultRuntimeMode?: RuntimeMode };

type ProviderOptionDescriptor =
	| { id: string; label: string; type: "select"; options: { id: string; label: string; isDefault?: boolean }[]; currentValue?: string; promptInjectedValues?: string[] }
	| { id: string; label: string; type: "boolean"; currentValue?: boolean };

/** The `ServerConfig` slice the deck reads (packages/contracts/src/server.ts). */
type ServerConfig = {
	environment?: { label?: string; capabilities?: Capabilities };
	providers?: {
		instanceId: string;
		driver?: string;
		displayName?: string;
		enabled?: boolean;
		supportedRuntimeModes?: RuntimeMode[];
		showInteractionModeToggle?: boolean;
		requiresNewThreadForModelChange?: boolean;
		models: { slug: string; name: string; shortName?: string; isLegacy?: boolean; isDefault?: boolean; capabilities?: { optionDescriptors?: ProviderOptionDescriptor[] } | null }[];
	}[];
	settings?: ProjectDefaults & { projectSettingsOverrides?: Record<string, ProjectDefaults> };
	shellResumeCompletionMarker?: boolean;
	shellThreadFamilies?: boolean;
	shellOlderSettled?: boolean;
	scratchWorkspaceRoot?: string;
};

export type ModelOptionInfo = {
	id: string;
	label: string;
	type: "select" | "boolean";
	values: { value: OptionValue; label: string }[];
	default?: OptionValue;
};
export type ProviderInfo = {
	instanceId: string;
	displayName: string;
	models: { id: string; label: string; isDefault: boolean; options: ModelOptionInfo[] }[];
	runtimeModes: RuntimeMode[] | undefined;
	interactionModeToggle: boolean;
	/** Switching models needs a new thread, so the deck does not offer it. */
	fixedModel: boolean;
};

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
type ThreadRef = Pick<ShellRow, "threadId">;

const APPROVAL_HEADING: Record<string, string> = {
	command: "Command approval",
	"file-read": "File read approval",
	"file-change": "File change approval",
	permission: "App permission approval",
	"mcp-elicitation": "App access approval",
};
/** Approvals the deck answers; others (tool calls, app access, auth) open in T3 Code. */
const ANSWERABLE = new Set(["command", "file-read", "file-change", "permission", "user_input"]);
const DECK_DECISIONS: Decision[] = ["accept", "acceptForSession", "decline"];

type TurnItem = {
	type: string;
	requestId?: string;
	prompt?: string;
	reason?: string;
	options?: { decision: Decision }[];
	questions?: Question[];
	responseMode?: "message";
};

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
	#rows: ShellRow[] = [];
	#subscribed = false;
	#snoozeTimer: ReturnType<typeof setTimeout> | undefined;
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
			return this.#set({ kind: "signed-out", message: "This pairing expired. Paste a new pair link." });
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
		clearTimeout(this.#snoozeTimer);
		rpc?.stop();
	}

	/** Reconnects now instead of waiting out the backoff, or after a fatal stop. */
	wake(): void {
		if (this.#rpc === undefined) return this.start();
		this.#rpc.wake();
	}

	/** Spends a pair link's one-time code. The current connection keeps running if it fails. */
	async pair(code: string): Promise<void> {
		const credential = await redeemPairingCode(this.url, code, this.deps.fetch, this.#now());
		this.stop();
		await this.store.save(this.url, credential);
		this.#reset();
		this.start();
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
		this.#rows = [];
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
					void this.store.save(this.url, undefined);
					this.#reset();
					return this.#set({ kind: "signed-out", message: error.message });
				}
				return this.#set({ kind: "error", message: error.message });
			}
		}
	}

	async #opened(rpc: RpcSocket, credential: Credential): Promise<void> {
		try {
			this.#config ??= await rpc.request<ServerConfig>("server.getConfig", {});
		} catch (error) {
			return rpc.drop(error as Error);
		}
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
			return this.#set({ kind: "error", message: "This pairing can't read threads. Paste a new pair link." });
		}
		rpc.drop(error ?? new Error("T3 Code ended the thread feed."));
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
	async send(thread: ThreadRef, text: string, mode: SendMode = "auto"): Promise<void> {
		this.#require("serverResolvedCommandContext", "take messages from the deck");
		await this.#dispatch({
			type: "message.dispatch",
			createdBy: "user",
			creationSource: "web",
			threadId: thread.threadId,
			messageId: this.#uuid(),
			text,
			attachments: [],
			...(mode === "queue" ? { dispatchMode: { type: "queue_after_active" } } : { dispatchMode: { type: "start_immediately" }, deliveryIntent: mode }),
		});
	}

	/**
	 * Starts a thread in a project, or in the scratch "no project" project. Model and access follow the
	 * project's override, then the app defaults; `fallbackModel` covers a server with no default model.
	 */
	async launch(
		target: { projectId: string } | { scratch: true },
		message: string,
		options: { title?: string; fallbackModel?: ModelSelection } = {},
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
		const threadId = this.#uuid();
		const title = options.title?.trim();
		await rpc.request("orchestration.launchThread", {
			commandId: this.#uuid(),
			creationSource: "web",
			threadId,
			projectId,
			title: title || titleSeed(message),
			generateTitle: !title,
			modelSelection,
			runtimeMode: override?.defaultRuntimeMode ?? settings?.defaultRuntimeMode ?? "full-access",
			interactionMode: "default",
			workspaceStrategy: { type: "root" },
			initialMessage: { messageId: this.#uuid(), text: message, attachments: [] },
		});
		return { threadId };
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
	 * Marks the thread read up to its current row, as T3 Code's visit tracker does. Every visit is broadcast
	 * to all clients, so callers send it only for an explicit open.
	 */
	async visit(thread: ThreadRef): Promise<void> {
		const visitedAt = this.#shell?.threads.get(thread.threadId)?.updatedAt;
		if (visitedAt === undefined || !this.canOperate || this.#capabilities.threadVisitedTracking !== true) return;
		await this.#dispatch({ type: "thread.visit", threadId: thread.threadId, visitedAt });
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
		const heading = APPROVAL_HEADING[pending.kind] ?? "Needs you in T3 Code";
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
		const decisions = offered === undefined ? DECK_DECISIONS : DECK_DECISIONS.filter((decision) => offered.includes(decision));
		return {
			type: "approval",
			...base,
			heading,
			summary: found.item.prompt?.trim() || found.item.reason?.trim() || heading,
			decisions: decisions.length > 0 ? decisions : DECK_DECISIONS,
		};
	}

	/** Takes the first bounded snapshot of a thread and unsubscribes. `live` is false when the provider can't take an answer. */
	#fromThreadSnapshot(rpc: RpcSocket, threadId: string, requestId: string): Promise<{ item: TurnItem | undefined; live: boolean } | undefined> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = (result: { item: TurnItem | undefined; live: boolean } | undefined) => {
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
					const snapshot = value as { kind?: string; projection?: { turnItems?: TurnItem[]; runtimeRequests?: { id: string; responseCapability?: { type?: string } }[] } };
					if (snapshot.kind !== "snapshot") return;
					const item = snapshot.projection?.turnItems?.findLast((candidate) => candidate.requestId === requestId);
					const capability = snapshot.projection?.runtimeRequests?.find((request) => request.id === requestId)?.responseCapability?.type;
					finish({ item, live: capability !== "not_resumable" });
				},
				{ onEnd: () => finish(undefined) },
			);
		});
	}

	async respond(threadId: string, requestId: string, decision: Decision): Promise<void> {
		await this.#dispatch({ type: "runtime-request.respond", threadId, requestId, decision });
	}

	async answer(threadId: string, requestId: string, answers: Record<string, string | string[]>): Promise<void> {
		await this.#dispatch({ type: "runtime-request.respond", threadId, requestId, answers });
	}

	/** Providers and their models' options from the cached server config, without prompt-injected values. */
	providers(): ProviderInfo[] {
		return (this.#config?.providers ?? [])
			.filter((provider) => provider.enabled !== false)
			.map((provider) => ({
				instanceId: provider.instanceId,
				displayName: provider.displayName ?? provider.driver ?? provider.instanceId,
				runtimeModes: provider.supportedRuntimeModes,
				interactionModeToggle: provider.showInteractionModeToggle !== false,
				fixedModel: provider.requiresNewThreadForModelChange === true,
				models: provider.models
					.filter((model) => model.isLegacy !== true)
					.map((model) => ({
						id: model.slug,
						label: model.shortName ?? model.name,
						isDefault: model.isDefault === true,
						options: (model.capabilities?.optionDescriptors ?? []).map(optionInfo),
					})),
			}));
	}

	/** Cheapest diff there is: the open pull request's totals from the shell row. */
	turnDiff(thread: Pick<ShellRow, "pullRequests">): { additions: number; deletions: number } | undefined {
		const open = thread.pullRequests.find((link) => link.state === "open" && (link.additions ?? 0) + (link.deletions ?? 0) > 0);
		return open === undefined ? undefined : { additions: open.additions ?? 0, deletions: open.deletions ?? 0 };
	}
}

function optionInfo(descriptor: ProviderOptionDescriptor): ModelOptionInfo {
	if (descriptor.type === "boolean") {
		return {
			id: descriptor.id,
			label: descriptor.label,
			type: "boolean",
			values: [
				{ value: false, label: "Off" },
				{ value: true, label: "On" },
			],
			default: descriptor.currentValue ?? false,
		};
	}
	const injected = new Set(descriptor.promptInjectedValues ?? []);
	return {
		id: descriptor.id,
		label: descriptor.label,
		type: "select",
		values: descriptor.options.filter((choice) => !injected.has(choice.id)).map((choice) => ({ value: choice.id, label: choice.label })),
		default: descriptor.currentValue ?? descriptor.options.find((choice) => choice.isDefault)?.id,
	};
}

/** A thread's value for an option: its own selection, else the provider's current or default value. */
export function currentOptionValue(selection: ModelSelection, option: ModelOptionInfo): OptionValue | undefined {
	return selection.options?.find((selected) => selected.id === option.id)?.value ?? option.default;
}

/** `selection` with option `id` set to `value`, keeping the others. */
export function withOptionValue(selection: ModelSelection, id: string, value: OptionValue): ModelSelection {
	const others = (selection.options ?? []).filter((selected) => selected.id !== id);
	return { ...selection, options: [...others, { id, value }] };
}
