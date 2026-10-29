import type { DeckThread } from "../../core/board.js";
import type { Machine } from "../../core/t3/machine.js";

type Listener = () => void;

// Stands in for src/deck.ts in golden tests; a test sets `world` before it drives a key.
export const world: { threads: DeckThread[]; selected: DeckThread | undefined; machines: Machine[]; selects: string[]; spawned: string[] } = {
	threads: [],
	selected: undefined,
	machines: [],
	selects: [],
	spawned: [],
};

const listeners: Listener[] = [];

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
	scheme: "t3",
	animator: { mode: "still", set: () => undefined },
	appearance: { confirmSend: "off", maxEffort: "solid" },
	acpIcons: {},
	queues: { of: () => undefined },
	ultrathink: { armed: () => false, prompt: (_key: string, _model: unknown, text: string) => text },
	transitions: undefined,
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
