import type { DeckThread, ThreadBoard } from "../core/board.js";
import { openExternal } from "../core/commands.js";
import { GitStatuses } from "../core/git.js";
import type { KeyRuntime } from "../core/keys/key.js";
import type { Machine } from "../core/t3/machine.js";

/** The sidecar's runtime for shared keys: no Appearance or Motion settings on Logitech, so faces stay still. */
export function logiRuntime(deps: { machines(): readonly Machine[]; board: ThreadBoard; openThread(thread: DeckThread): Promise<void>; selectThread(thread: Pick<DeckThread, "key" | "machine">): void; repaint(): void; warn(message: string): void }): KeyRuntime {
	return {
		...deps,
		openExternal,
		appearance: () => ({}),
		acpIcons: undefined,
		motion: () => "reduced",
		// shortcut: no flash wash or queue badge on Logitech faces, which stay still; read queues on demand if a keypad tile should show them.
		transitions: { age: () => undefined },
		queued: () => 0,
		scheme: () => undefined,
		// Ultrathink only prefixes prompts Turnkey sends, and on Logitech you type yours in T3 Code.
		ultrathink: undefined,
		git: new GitStatuses(deps.repaint),
		openUrl: openExternal,
	};
}
