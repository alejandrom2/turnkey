import { vi } from "vitest";

import type { DeckThread } from "../../core/board.js";
import type { Machine, PendingRequest } from "../../core/t3/machine.js";
import type { GoldenOptions } from "./harness.js";

/** A ready, operable machine whose operations are spies; `pendingRequest` resolves to `request`. */
export function machine(
	overrides: Partial<Record<keyof Machine, unknown>> & {
		request?: PendingRequest | Promise<PendingRequest | undefined>;
		/** What `call` answers by RPC tag; a function answers with its result, an Error throws. */
		rpc?: Record<string, unknown>;
		/** What `stream` hands its callback by RPC tag. */
		streams?: Record<string, unknown[]>;
	} = {},
): Machine {
	const { request, rpc = {}, streams = {}, ...rest } = overrides;
	return {
		url: "http://studio:3773",
		environmentId: "env",
		canOperate: true,
		settled: true,
		state: { kind: "ready", environmentId: "env", label: "Studio", canOperate: true },
		modelConfig: undefined,
		pendingRequest: vi.fn(async () => request),
		respond: vi.fn(async () => undefined),
		stop: vi.fn(async () => undefined),
		send: vi.fn(async () => undefined),
		// What the board would show once T3 Code applies the change, so a press record includes the face that follows it.
		setModelSelection: vi.fn(async (target: DeckThread, model: DeckThread["model"]) => void (target.model = model)),
		setRuntimeMode: vi.fn(async (target: DeckThread, mode: DeckThread["runtimeMode"]) => void (target.runtimeMode = mode)),
		setInteractionMode: vi.fn(async (target: DeckThread, mode: DeckThread["interactionMode"]) => void (target.interactionMode = mode)),
		call: vi.fn(async (tag: string) => {
			const answer = rpc[tag];
			if (answer instanceof Error) throw answer;
			return typeof answer === "function" ? (answer as () => unknown)() : answer;
		}),
		stream: vi.fn(async (tag: string, _payload: unknown, onValue: (value: unknown) => void) => void (streams[tag] ?? []).forEach(onValue)),
		scopes: ["orchestration:read", "orchestration:operate", "source-control:write"],
		project: () => ({ id: "project", title: "Project", workspaceRoot: "/work/project" }),
		isScratch: () => false,
		turnDiff: () => undefined,
		editors: [],
		everyRow: [],
		threadRow: () => undefined,
		projects: [],
		watchConfig: () => () => undefined,
		live: () => () => undefined,
		htmlRender: vi.fn(async () => undefined),
		assetUrl: vi.fn(async () => "https://assets.test/render.html"),
		launch: vi.fn(async () => ({ threadId: "new-thread" })),
		worktreeStrategy: vi.fn(async () => ({ type: "new_worktree" })),
		settle: vi.fn(async () => undefined),
		unsettle: vi.fn(async () => undefined),
		pin: vi.fn(async (target: DeckThread) => void (target.pinned = true)),
		unpin: vi.fn(async (target: DeckThread) => void (target.pinned = false)),
		snooze: vi.fn(async () => undefined),
		unsnooze: vi.fn(async () => undefined),
		archive: vi.fn(async () => undefined),
		markUnread: vi.fn(async () => undefined),
		fork: vi.fn(async () => ({ threadId: "fork-1" })),
		mergeBack: vi.fn(async () => undefined),
		workflows: vi.fn(async () => []),
		stopWorkflow: vi.fn(async () => undefined),
		stopRun: vi.fn(async (target: DeckThread) => void Object.assign(target, { active: false, deck: "idle", runStatus: "idle" })),
		...rest,
	} as unknown as Machine;
}

/** A thread with the fields keys read; override what a test cares about. */
export function thread(overrides: Partial<DeckThread> & { machine?: Machine } = {}): DeckThread {
	const id = overrides.threadId ?? "thread-1";
	return {
		threadId: id,
		key: `env/${id}`,
		environmentId: "env",
		machine: machine(),
		projectId: "project",
		projectTitle: "Project",
		title: "Thread",
		deck: "idle",
		runStatus: "idle",
		active: false,
		unseen: false,
		pinned: false,
		model: { instanceId: "codex", model: "gpt-5" },
		runtimeMode: "approval-required",
		interactionMode: "default",
		pendingRequest: undefined,
		updatedAt: Date.parse("2026-06-01T11:00:00Z"),
		activeRunId: null,
		latestRunId: "run-1",
		runStamp: "run-1",
		pullRequests: [],
		subagents: 0,
		...overrides,
	} as unknown as DeckThread;
}

/** A machine that has not connected: its keys draw the connection face. */
export const offline = (): Machine => machine({ state: { kind: "error", message: "refused" }, settled: true, canOperate: false });

/** A model config with Codex (reasoning effort, a Fast tier) and Claude (effort, Fast mode, no plan toggle). */
export const modelConfig = (overrides: { codexPlanToggle?: boolean } = {}) => ({
	providers: [
		{
			instanceId: "codex",
			driver: "codex",
			showInteractionModeToggle: overrides.codexPlanToggle,
			models: [
				{
					slug: "gpt-5",
					name: "GPT-5",
					capabilities: {
						optionDescriptors: [
							{ id: "reasoningEffort", label: "Reasoning", type: "select", options: [{ id: "low", label: "Low" }, { id: "medium", label: "Medium", isDefault: true }, { id: "high", label: "High" }] },
							{ id: "serviceTier", label: "Speed", type: "select", options: [{ id: "default", label: "Standard", isDefault: true }, { id: "fast", label: "Fast" }] },
						],
					},
				},
				{ slug: "gpt-5-mini", name: "GPT-5 mini", capabilities: { optionDescriptors: [] } },
			],
		},
		{
			instanceId: "claudeAgent",
			driver: "claudeAgent",
			supportedRuntimeModes: ["approval-required", "full-access"],
			models: [
				{
					slug: "opus",
					name: "Opus",
					capabilities: {
						optionDescriptors: [
							{ id: "effort", label: "Effort", type: "select", options: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }] },
							{ id: "fastMode", label: "Fast mode", type: "boolean" },
						],
					},
				},
			],
		},
	],
});

export const NOW = Date.parse("2026-06-01T12:00:00Z");

let serial = 0;
/** Keys cache what they read per machine URL and thread id, so every scene gets its own. */
export const uniqueUrl = (): string => `http://machine-${serial++}:3773`;

/** One thread, selected, on its own machine (with a model config); `machineOverrides` shape the machine. */
export function scene(overrides: Partial<DeckThread> = {}, machineOverrides: Parameters<typeof machine>[0] = {}): GoldenOptions {
	const owner = machine({ url: uniqueUrl(), modelConfig: modelConfig(), ...machineOverrides });
	const selected = thread({ threadId: `thread-${serial++}`, machine: owner, ...overrides });
	return { threads: [selected], selected };
}

export const RUNNING: Partial<DeckThread> = { deck: "running", runStatus: "running", active: true, activeSince: NOW - 90_000, activeRunId: "run-2" };

const waitingOn = (kind: string): Partial<DeckThread> => ({ deck: kind === "approval" ? "approval" : "question", pendingRequest: { id: "req", kind, createdAt: "", threadId: "x" } });

/** The states most keys draw differently: no T3 Code, a machine that is down, no thread, a read-only pairing, then threads. */
export const STATES = {
	none: (): GoldenOptions => ({}),
	offline: (): GoldenOptions => ({ machines: [offline()] }),
	"no-thread": (): GoldenOptions => ({ machines: [machine({ url: uniqueUrl() })] }),
	"read-only": (): GoldenOptions => scene({}, { canOperate: false }),
	idle: (): GoldenOptions => scene(),
	running: (): GoldenOptions => scene(RUNNING),
	approval: (): GoldenOptions => scene(waitingOn("approval")),
	question: (): GoldenOptions => scene(waitingOn("question")),
} satisfies Record<string, () => GoldenOptions>;
