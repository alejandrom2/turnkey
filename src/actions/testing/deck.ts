import type { DeckThread } from "../../core/board.js";
import type { Machine } from "../../core/t3/machine.js";

type Listener = () => void;

// Stands in for src/deck.ts in golden tests; a test sets `world` before it drives a key.
export const world: { threads: DeckThread[]; selected: DeckThread | undefined; machines: Machine[]; selects: string[]; spawned: string[]; motion: "full" | "reduced" | "off" } = {
	threads: [],
	selected: undefined,
	machines: [],
	selects: [],
	spawned: [],
	motion: "off",
};

const listeners: Listener[] = [];

// What registered while the modules loaded (a MachineWatch listens for repaints) stays; every key a golden builds goes.
let kept: number | undefined;
/** Forgets the keys earlier goldens built: each action registers a repaint listener when constructed. */
export const resetListeners = () => {
	kept ??= listeners.length;
	listeners.length = kept;
};

const found = (key: string) => {
	const thread = world.threads.find((candidate) => candidate.key === key);
	return thread === undefined ? ({ state: "gone" } as const) : ({ state: "found", thread } as const);
};

export const deck = {
	loaded: true,
	get machines() {
		return world.machines;
	},
	onRepaint: (listener: Listener) => void listeners.push(listener),
	repaint: () => listeners.forEach((listener) => listener()),
	setVisible: () => undefined,
	retry: async () => undefined,
	refreshConfigs: async () => undefined,
	optInScope: async (url: string, ...scopes: string[]) => void world.spawned.push(`optInScope ${url} ${scopes.join(" ")}`),
	scopeRequested: () => false,
	scheme: "t3",
	animator: {
		get mode() {
			return world.motion;
		},
		set: () => undefined,
	},
	appearance: { confirmSend: "off", maxEffort: "solid" },
	acpIcons: {},
	queues: { of: () => undefined },
	ultrathink: { armed: () => false, prompt: (_key: string, _model: unknown, text: string) => text },
	transitions: { age: () => undefined },
	useChecklist: () => undefined,
	board: {
		get threads() {
			return world.threads;
		},
		threadsOn: () => world.threads,
		selectedOn: () => world.selected,
		lookup: found,
		pin: () => undefined,
		select: async (key: string) => void world.selects.push(key),
	},
};
