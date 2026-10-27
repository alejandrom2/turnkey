import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type CredentialStore, Machine } from "./machine.js";
import type { Credential } from "./pairing.js";
import type { ShellRow, ThreadShell } from "./shell.js";
import { environmentRoute, type FakeSocket, fakeFetch, fakeSockets } from "./testing.js";

const URL_ = "http://studio:3773";
const NOW = Date.parse("2026-10-27T10:00:00.000Z");

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(NOW);
	vi.stubGlobal("fetch", () => Promise.reject(new Error("tests must not use the network")));
	vi.stubGlobal("WebSocket", class {
		constructor() {
			throw new Error("tests must not open real sockets");
		}
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

const CREDENTIAL: Credential = {
	token: "tok",
	expiresAt: NOW + 30 * 86_400_000,
	scopes: ["orchestration:read", "orchestration:operate"],
	label: "Studio",
	environmentId: "env-1",
};

const CONFIG = {
	environment: { environmentId: "env-1", label: "Studio", capabilities: { serverResolvedCommandContext: true, threadStop: true, threadVisitedTracking: true, threadSnooze: true } },
	providers: [
		{
			instanceId: "claudeAgent",
			driver: "claudeAgent",
			displayName: "Claude",
			enabled: true,
			models: [
				{
					slug: "claude-opus-5-5",
					name: "Claude Opus 5.5",
					shortName: "Opus 5.5",
					isCustom: false,
					isDefault: true,
					capabilities: {
						optionDescriptors: [
							{
								id: "effort",
								label: "Reasoning",
								type: "select",
								options: [
									{ id: "medium", label: "Medium", isDefault: true },
									{ id: "high", label: "High" },
									{ id: "ultrathink", label: "Ultrathink" },
								],
								promptInjectedValues: ["ultrathink"],
							},
							{ id: "fastMode", label: "Fast Mode", type: "boolean" },
						],
					},
				},
				{ slug: "claude-old", name: "Old", isCustom: false, isLegacy: true, capabilities: null },
			],
		},
	],
	settings: { defaultModelSelection: null, defaultRuntimeMode: "approval-required", projectSettingsOverrides: {} },
	shellResumeCompletionMarker: true,
	shellThreadFamilies: true,
	shellOlderSettled: true,
	scratchWorkspaceRoot: "/Users/me/.t3/scratch",
};

const THREAD: ThreadShell = {
	id: "thr_123",
	projectId: "p-1",
	title: "Fix flaky shell resume test",
	modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5", options: [{ id: "effort", value: "high" }] },
	runtimeMode: "approval-required",
	interactionMode: "default",
	latestRunId: "run:4",
	activeRunId: "run:4",
	activityRunStatus: "running",
	activityRunStartedAt: "2026-10-27T09:59:00.000Z",
	status: "running",
	pendingRuntimeRequest: { id: "runtime-request:claudeAgent:toolu_01AbC", kind: "command", createdAt: "2026-10-27T09:59:30.000Z", blocking: true },
	updatedAt: "2026-10-27T09:59:30.500Z",
	lastVisitedAt: "2026-10-27T09:00:00.000Z",
};

function memoryStore(initial?: Credential) {
	const saved = new Map<string, Credential>(initial ? [[URL_, initial]] : []);
	const store: CredentialStore = {
		load: (url) => saved.get(url),
		save: async (url, credential) => void (credential ? saved.set(url, credential) : saved.delete(url)),
	};
	return { store, saved };
}

function setup(options: { credential?: Credential; ticket?: () => Response; config?: object } = {}) {
	const { store, saved } = memoryStore(options.credential ?? CREDENTIAL);
	let tickets = 0;
	const { fetch, calls } = fakeFetch({
		"/.well-known/t3/environment": environmentRoute(),
		"/oauth/token": () => Response.json({ access_token: "fresh", token_type: "Bearer", expires_in: 2_592_000, scope: "orchestration:read orchestration:operate" }),
		"/api/auth/websocket-ticket/rpc": options.ticket ?? (() => Response.json({ ticket: `ticket-${++tickets}` })),
	});
	const sockets = fakeSockets();
	let ids = 0;
	const onChange = vi.fn();
	const machine = new Machine(URL_, store, { fetch, socket: sockets.factory, random: () => 0, uuid: () => `uuid-${++ids}` }, onChange);
	return { machine, sockets, calls, saved, onChange, config: options.config ?? CONFIG };
}

/** Opens the socket, answers getConfig and delivers a shell snapshot. */
async function connect(h: ReturnType<typeof setup>, threads: ThreadShell[] = [THREAD], sequence = 4812) {
	h.machine.start();
	await flush();
	const socket = h.sockets.last;
	socket.open();
	socket.reply("server.getConfig", h.config);
	await flush();
	const shell = socket.request("orchestration.subscribeShell");
	socket.receive({
		_tag: "Chunk",
		requestId: shell.id,
		values: [{ kind: "snapshot", snapshot: { snapshotSequence: sequence, projects: [{ id: "p-1", title: "app", workspaceRoot: "/Users/me/code/app" }], threads } }],
	});
	return socket;
}

/** Runs a verb, answers its dispatch and returns the command it sent. */
async function dispatched(socket: FakeSocket, verb: () => Promise<unknown>): Promise<Record<string, unknown>> {
	const done = verb();
	await flush();
	const command = socket.request("orchestration.dispatchCommand");
	socket.reply("orchestration.dispatchCommand", { sequence: 4813 });
	await done;
	return command.payload;
}

const row = (machine: Machine): ShellRow => {
	const first = machine.rows[0];
	if (first === undefined) throw new Error("no rows");
	return first;
};

describe("Machine connection", () => {
	it("pairs, subscribes to the shell with the advertised options and lists threads", async () => {
		const h = setup({ credential: undefined as unknown as Credential });
		h.saved.clear();
		h.machine.start();
		expect(h.machine.state).toEqual({ kind: "signed-out" });

		await h.machine.pair("CODE");
		expect(h.saved.get(URL_)).toMatchObject({ token: "fresh", environmentId: "env-1", label: "Studio" });
		await flush();
		const socket = h.sockets.last;
		expect(socket.url).toBe("ws://studio:3773/ws?orchestrationProtocol=2&wsTicket=ticket-1");
		socket.open();
		socket.reply("server.getConfig", CONFIG);
		await flush();
		expect(socket.request("orchestration.subscribeShell").payload).toEqual({ requestCompletionMarker: true, omitIdleSubagents: true, omitOlderSettled: true });
		expect(h.machine.state).toEqual({ kind: "ready", environmentId: "env-1", label: "Studio", canOperate: true });

		socket.receive({
			_tag: "Chunk",
			requestId: socket.request("orchestration.subscribeShell").id,
			values: [{ kind: "snapshot", snapshot: { snapshotSequence: 1, projects: [{ id: "p-1", title: "app", workspaceRoot: "/x" }], threads: [THREAD] } }],
		});
		expect(row(h.machine)).toMatchObject({ threadId: "thr_123", projectTitle: "app", deck: "approval" });
	});

	it("resumes the shell after a drop without a new snapshot, and re-reads the config alongside", async () => {
		const h = setup();
		const first = await connect(h);
		first.receive({ _tag: "Chunk", requestId: first.request("orchestration.subscribeShell").id, values: [{ kind: "thread.updated", sequence: 4815, location: "active", thread: THREAD }] });
		first.drop();
		expect(h.machine.state.kind).toBe("connecting");

		await vi.advanceTimersByTimeAsync(1_000);
		const second = h.sockets.last;
		expect(second).not.toBe(first);
		second.open();
		await flush();
		expect(second.request("orchestration.subscribeShell").payload).toMatchObject({ afterSequence: 4815 });
		expect(h.machine.state.kind).toBe("ready");
		expect(h.machine.rows).toHaveLength(1);
		const favorites = [{ provider: "claudeAgent", model: "claude-opus-5-5" }];
		second.reply("server.getConfig", { ...CONFIG, settings: { ...CONFIG.settings, favorites } });
		await flush();
		expect(h.machine.modelConfig?.settings?.favorites).toEqual(favorites);
		expect(h.machine.configVersion).toBe(2);
	});

	it("signs out and forgets the token when T3 Code ends the session", async () => {
		let revoked = false;
		const h = setup({ ticket: () => (revoked ? Response.json({ reason: "invalid_credential" }, { status: 401 }) : Response.json({ ticket: "t" })) });
		const socket = await connect(h);
		revoked = true;
		socket.drop();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(h.machine.state).toMatchObject({ kind: "signed-out", message: expect.stringContaining("new pair link") });
		expect(h.saved.has(URL_)).toBe(false);
		expect(h.machine.rows).toEqual([]);
		expect(h.sockets.sockets).toHaveLength(1);
	});

	it("does not connect with an expired pairing", () => {
		const h = setup({ credential: { ...CREDENTIAL, expiresAt: NOW - 1 } });
		h.machine.start();
		expect(h.machine.state).toMatchObject({ kind: "signed-out", message: expect.stringContaining("expired") });
		expect(h.calls).toEqual([]);
	});

	it("is read-only when the pairing did not grant orchestration:operate", async () => {
		const h = setup({ credential: { ...CREDENTIAL, scopes: ["orchestration:read"] } });
		await connect(h);
		expect(h.machine.canOperate).toBe(false);
		await expect(h.machine.archive(row(h.machine))).rejects.toThrow("read-only");
	});
});

describe("Machine commands", () => {
	it("answers approvals and questions as the thread that asked", async () => {
		const h = setup();
		const socket = await connect(h);
		expect(await dispatched(socket, () => h.machine.respond("child", "rr_456", "acceptForSession"))).toEqual({
			type: "runtime-request.respond",
			threadId: "child",
			requestId: "rr_456",
			decision: "acceptForSession",
			commandId: "uuid-1",
		});
		expect(await dispatched(socket, () => h.machine.answer("thr_123", "rr_789", { q1: "postgres" }))).toEqual({
			type: "runtime-request.respond",
			threadId: "thr_123",
			requestId: "rr_789",
			answers: { q1: "postgres" },
			commandId: "uuid-2",
		});
	});

	it("stops with thread.stop, or interrupts the active run on servers without it", async () => {
		const h = setup();
		const socket = await connect(h);
		expect(await dispatched(socket, () => h.machine.stopRun(row(h.machine)))).toMatchObject({ type: "thread.stop", threadId: "thr_123" });

		const old = setup({ config: { ...CONFIG, environment: { ...CONFIG.environment, capabilities: { serverResolvedCommandContext: true } } } });
		const oldSocket = await connect(old);
		expect(await dispatched(oldSocket, () => old.machine.stopRun(row(old.machine)))).toEqual({
			type: "run.interrupt",
			threadId: "thr_123",
			runId: "run:4",
			holdQueue: true,
			commandId: "uuid-1",
		});
	});

	it("dispatches messages with the server-resolved delivery modes", async () => {
		const h = setup();
		const socket = await connect(h);
		const base = { type: "message.dispatch", createdBy: "user", creationSource: "mobile", threadId: "thr_123", text: "Also update the docs", attachments: [] };
		expect(await dispatched(socket, () => h.machine.send(row(h.machine), "Also update the docs"))).toEqual({
			...base,
			messageId: "uuid-1",
			commandId: "uuid-2",
			dispatchMode: { type: "start_immediately" },
			deliveryIntent: "auto",
		});
		expect(await dispatched(socket, () => h.machine.send(row(h.machine), "Also update the docs", "restart"))).toMatchObject({ dispatchMode: { type: "start_immediately" }, deliveryIntent: "restart" });
		expect(await dispatched(socket, () => h.machine.send(row(h.machine), "Keep it small", "steer"))).toMatchObject({ text: "Keep it small", dispatchMode: { type: "start_immediately" }, deliveryIntent: "steer" });
		const queued = await dispatched(socket, () => h.machine.send(row(h.machine), "Also update the docs", "queue"));
		expect(queued).toMatchObject({ dispatchMode: { type: "queue_after_active" } });
		expect(queued).not.toHaveProperty("deliveryIntent");
	});

	it("visits at the row's own updatedAt, and snoozes to an absolute time", async () => {
		const h = setup();
		const socket = await connect(h);
		expect(await dispatched(socket, () => h.machine.visit(row(h.machine)))).toMatchObject({ type: "thread.visit", threadId: "thr_123", visitedAt: "2026-10-27T09:59:30.500Z" });
		const opened = await dispatched(socket, () => h.machine.visit(row(h.machine), { opened: true }));
		expect(opened).toMatchObject({ type: "thread.visit", visitedAt: "2026-10-27T09:59:30.500Z", opened: true });
		expect(await dispatched(socket, () => h.machine.snooze(row(h.machine), 30))).toMatchObject({ type: "thread.snooze", snoozedUntil: "2026-10-27T10:30:00.000Z" });
		await expect(h.machine.pin(row(h.machine))).rejects.toThrow("can't pin threads");
	});

	it("launches into a project with the app defaults and a seeded title", async () => {
		const h = setup();
		const socket = await connect(h);
		const launched = h.machine.launch({ projectId: "p-1" }, "Add retry to the upload client\nand tests", { fallbackModel: THREAD.modelSelection });
		await flush();
		const request = socket.request("orchestration.launchThread");
		socket.reply("orchestration.launchThread", { threadId: "uuid-1", projection: {}, resumed: false });
		expect(await launched).toEqual({ threadId: "uuid-1" });
		expect(request.payload).toEqual({
			commandId: "uuid-2",
			creationSource: "mobile",
			threadId: "uuid-1",
			projectId: "p-1",
			title: "Add retry to the upload client",
			generateTitle: true,
			modelSelection: THREAD.modelSelection,
			runtimeMode: "approval-required",
			interactionMode: "default",
			workspaceStrategy: { type: "root" },
			initialMessage: { messageId: "uuid-3", text: "Add retry to the upload client\nand tests", attachments: [] },
		});
	});

	it("launches into the scratch project after ensuring it", async () => {
		const h = setup();
		const socket = await connect(h);
		const launched = h.machine.launch({ scratch: true }, "Try something");
		await flush();
		socket.reply("projects.ensureScratch", { projectId: "scratch-1" });
		await flush();
		expect(socket.request("orchestration.launchThread").payload).toMatchObject({ projectId: "scratch-1", modelSelection: { instanceId: "claudeAgent", model: "claude-opus-5-5" } });
		socket.reply("orchestration.launchThread", { threadId: "uuid-1" });
		await launched;
	});
});

describe("Machine thread settings", () => {
	it("sets the model, within a provider and across to another, with the options it was given", async () => {
		const h = setup();
		const socket = await connect(h);
		const sonnet = { instanceId: "claudeAgent", model: "claude-sonnet-5", options: [{ id: "effort", value: "high" }] };
		expect(await dispatched(socket, () => h.machine.setModelSelection(row(h.machine), sonnet))).toEqual({
			type: "thread.model-selection.set",
			threadId: "thr_123",
			modelSelection: sonnet,
			commandId: "uuid-1",
		});
		expect(await dispatched(socket, () => h.machine.setModelSelection(row(h.machine), { instanceId: "codex", model: "gpt-5.5" }))).toEqual({
			type: "thread.model-selection.set",
			threadId: "thr_123",
			modelSelection: { instanceId: "codex", model: "gpt-5.5" },
			commandId: "uuid-2",
		});
	});

	it("sets access and Build/Plan mode", async () => {
		const h = setup();
		const socket = await connect(h);
		expect(await dispatched(socket, () => h.machine.setRuntimeMode(row(h.machine), "auto-accept-edits"))).toEqual({
			type: "thread.runtime-mode.set",
			threadId: "thr_123",
			runtimeMode: "auto-accept-edits",
			commandId: "uuid-1",
		});
		expect(await dispatched(socket, () => h.machine.setInteractionMode(row(h.machine), "plan"))).toEqual({
			type: "thread.interaction-mode.set",
			threadId: "thr_123",
			interactionMode: "plan",
			commandId: "uuid-2",
		});
	});

	it("sends the Approve key's authority and Deny's decline as decisions", async () => {
		const h = setup();
		const socket = await connect(h);
		for (const decision of ["accept", "acceptForSession", "acceptAlways", "decline"] as const) {
			expect(await dispatched(socket, () => h.machine.respond("thr_123", "rr_1", decision))).toMatchObject({ type: "runtime-request.respond", threadId: "thr_123", requestId: "rr_1", decision });
		}
	});

	it("surfaces T3 Code's reason when it refuses a provider switch", async () => {
		const h = setup();
		const socket = await connect(h);
		const switching = h.machine.setModelSelection(row(h.machine), { instanceId: "cursor", model: "auto" });
		await flush();
		const reason = "The target provider instance is unavailable.";
		socket.receive({
			_tag: "Exit",
			requestId: socket.request("orchestration.dispatchCommand").id,
			exit: {
				_tag: "Failure",
				cause: [
					{
						_tag: "Fail",
						error: {
							_tag: "OrchestrationDispatchCommandError",
							message: "Failed to dispatch orchestration command thread.model-selection.set (uuid-1).",
							cause: { name: "OrchestratorDispatchError", message: "Failed to dispatch orchestration command thread.model-selection.set (uuid-1).", cause: { name: "ProviderSwitchPlanError", message: "", cause: reason } },
						},
					},
				],
			},
		});
		await expect(switching).rejects.toMatchObject({ tag: "OrchestrationDispatchCommandError", reason });
	});

	it("re-reads the config on demand, once for overlapping callers, and nothing offline", async () => {
		const h = setup();
		const socket = await connect(h);
		const before = socket.sent.filter((frame) => frame.tag === "server.getConfig").length;
		const both = Promise.all([h.machine.refreshConfig(), h.machine.refreshConfig()]);
		await flush();
		expect(socket.sent.filter((frame) => frame.tag === "server.getConfig")).toHaveLength(before + 1);
		socket.reply("server.getConfig", { ...CONFIG, settings: { ...CONFIG.settings, favorites: [] } });
		await both;
		expect(h.machine.modelConfig?.settings?.favorites).toEqual([]);

		const offline = setup();
		await offline.machine.refreshConfig();
		expect(offline.sockets.sockets).toHaveLength(0);
	});

	it("starts an empty thread without an initial message or a generated title", async () => {
		const h = setup();
		const socket = await connect(h);
		const launched = h.machine.launch({ projectId: "p-1" }, "  ", { fallbackModel: THREAD.modelSelection });
		await flush();
		const request = socket.request("orchestration.launchThread");
		socket.reply("orchestration.launchThread", { threadId: "uuid-1" });
		await launched;
		expect(request.payload).toMatchObject({ projectId: "p-1", title: "New thread", generateTitle: false });
		expect(request.payload).not.toHaveProperty("initialMessage");
	});
});

describe("Machine details", () => {
	it("reads an approval from its turn item and offers only the decisions the adapter takes", async () => {
		const h = setup();
		const socket = await connect(h);
		const loading = h.machine.pendingRequest(row(h.machine));
		await flush();
		expect(socket.request("orchestration.getTurnItem").payload).toEqual({
			threadId: "thr_123",
			itemId: "turn-item:runtime-request:runtime-request%3AclaudeAgent%3Atoolu_01AbC",
		});
		socket.reply("orchestration.getTurnItem", {
			item: {
				type: "approval_request",
				requestId: "runtime-request:claudeAgent:toolu_01AbC",
				requestKind: "command",
				prompt: "pnpm test --filter shell",
				reason: "Run the shell tests",
				options: [
					{ decision: "accept", label: "Approve" },
					{ decision: "decline", label: "Decline" },
					{ decision: "cancel", label: "Cancel" },
				],
			},
		});
		expect(await loading).toEqual({
			type: "approval",
			threadId: "thr_123",
			requestId: "runtime-request:claudeAgent:toolu_01AbC",
			heading: "Command approval",
			summary: "pnpm test --filter shell",
			decisions: ["accept", "decline"],
		});
	});

	it("offers Always allow only when the adapter lists it", async () => {
		const h = setup();
		const socket = await connect(h);
		const loading = h.machine.pendingRequest(row(h.machine));
		await flush();
		const item = { type: "approval_request", requestId: "runtime-request:claudeAgent:toolu_01AbC", requestKind: "command", prompt: "ls" };
		socket.reply("orchestration.getTurnItem", { item: { ...item, options: [{ decision: "acceptAlways" }, { decision: "decline" }] } });
		expect(await loading).toMatchObject({ type: "approval", decisions: ["acceptAlways", "decline"] });
		const unlisted = h.machine.pendingRequest(row(h.machine));
		await flush();
		socket.reply("orchestration.getTurnItem", { item });
		expect(await unlisted).toMatchObject({ type: "approval", decisions: ["accept", "acceptForSession", "decline"] });
	});

	it("falls back to one bounded thread snapshot for questions, then unsubscribes", async () => {
		const h = setup();
		const question = { ...THREAD, pendingRuntimeRequest: { id: "rr_q", kind: "user_input", createdAt: "x" } };
		const socket = await connect(h, [question]);
		const loading = h.machine.pendingRequest(row(h.machine));
		await flush();
		socket.reply("orchestration.getTurnItem", { item: null });
		await flush();
		const subscription = socket.request("orchestration.subscribeThread");
		expect(subscription.payload).toEqual({ threadId: "thr_123", acceptBoundedSnapshot: true });
		const questions = [{ id: "q1", header: "Database", question: "Which database?", options: [{ label: "Postgres", description: "Prod", value: "postgres" }] }];
		socket.receive({
			_tag: "Chunk",
			requestId: subscription.id,
			values: [
				{
					kind: "snapshot",
					snapshotSequence: 9,
					projection: {
						turnItems: [{ type: "user_input_request", requestId: "rr_q", questions, responseMode: "message" }],
						runtimeRequests: [{ id: "rr_q", kind: "user_input", responseCapability: { type: "message" } }],
					},
				},
			],
		});
		expect(await loading).toEqual({ type: "question", threadId: "thr_123", requestId: "rr_q", questions, messageMode: true });
		expect(socket.sent.at(-1)).toEqual({ _tag: "Interrupt", requestId: subscription.id });
	});
});
