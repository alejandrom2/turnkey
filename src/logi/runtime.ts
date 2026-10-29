import type { DeckThread, ThreadBoard } from "../core/board.js";
import { openExternal } from "../core/commands.js";
import { GitStatuses } from "../core/git.js";
import type { KeyRuntime } from "../core/keys/key.js";
import type { Machine } from "../core/t3/machine.js";
import { UsageStore } from "../core/usage/store.js";

/** The sidecar's runtime for shared keys: no Appearance or Motion settings on Logitech, so faces stay still. */
export function logiRuntime(deps: { machines(): readonly Machine[]; board: ThreadBoard; openThread(thread: DeckThread): Promise<void>; selectThread(thread: Pick<DeckThread, "key" | "machine">): void; repaint(): void; warn(message: string): void }): KeyRuntime {
	return {
		...deps,
		openExternal,
		appearance: () => ({}),
		acpIcons: undefined,
		// Off, not Reduced: Logi draws no animation frames, so a keypad tile would freeze a spinner or twinkle mid-turn.
		motion: () => "off",
		// shortcut: no flash wash or queue badge on Logitech faces, which stay still; read queues on demand if a keypad tile should show them.
		transitions: { age: () => undefined },
		queued: () => 0,
		scheme: () => undefined,
		locale: () => undefined,
		// Ultrathink only prefixes prompts Turnkey sends, and on Logitech you type yours in T3 Code.
		ultrathink: undefined,
		git: new GitStatuses(deps.repaint),
		openUrl: openExternal,
		refreshConfigs: async (url) => {
			await Promise.all(deps.machines().filter((machine) => url === undefined || machine.url === url).map((machine) => machine.refreshConfig()));
		},
		// As the sidecar's Machines.wake: reconnect now, without waiting out the backoff.
		retry: async (url) => {
			for (const machine of deps.machines()) if (url === undefined || machine.url === url) machine.wake();
		},
		// A slow scan is only an info line on Stream Deck; the sidecar's log has no place for it.
		usage: new UsageStore(deps.repaint, Date.now, () => undefined),
		// Only keypad tiles show it: the Ring draws glyphs, and a click there is the confirmation.
		holdHints: true,
	};
}
