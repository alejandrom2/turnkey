import type { KeyRuntime } from "../core/keys/key.js";
import { deck } from "../deck.js";
import { openThread, queuedCount, selectThread } from "./base.js";
import { openExternal } from "../core/commands.js";

export const deckRuntime: KeyRuntime = {
	machines: () => deck.machines,
	board: deck.board,
	openThread,
	openExternal,
	repaint: () => deck.repaint(),
	appearance: () => deck.appearance,
	acpIcons: deck.acpIcons,
	motion: () => deck.animator.mode,
	transitions: deck.transitions,
	queued: queuedCount,
	selectThread,
	scheme: () => deck.scheme,
};
