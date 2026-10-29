import { vi } from "vitest";

import type { DeckThread } from "../../core/board.js";
import type { Machine, PendingRequest } from "../../core/t3/machine.js";

/** A ready, operable machine whose operations are spies; `pendingRequest` resolves to `request`. */
export function machine(overrides: Partial<Record<keyof Machine, unknown>> & { request?: PendingRequest | Promise<PendingRequest | undefined> } = {}): Machine {
	const { request, ...rest } = overrides;
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
		pullRequests: [],
		subagents: 0,
		...overrides,
	} as unknown as DeckThread;
}
