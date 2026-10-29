import type { DeckThread, ThreadBoard } from "../core/board.js";
import { openExternal } from "../core/commands.js";
import type { KeyRuntime } from "../core/keys/key.js";
import type { Machine } from "../core/t3/machine.js";

/** The sidecar's runtime for shared keys: no Appearance or Motion settings on Logitech, so faces stay still. */
export function logiRuntime(deps: { machines(): readonly Machine[]; board: ThreadBoard; openThread(thread: DeckThread): Promise<void>; repaint(): void }): KeyRuntime {
	return { ...deps, openExternal, appearance: () => ({}), acpIcons: undefined, motion: () => "reduced" };
}
