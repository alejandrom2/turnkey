import { EventEmitter } from "node:events";

import { world } from "./deck.js";

/** Stands in for `spawn`, so a key that opens T3 Code never launches anything: records the command and exits 0. */
export function spawn(command: string, args: readonly string[]) {
	// The OS opener differs by platform; goldens read the same everywhere.
	const clipboard = ["pbcopy", "clip", "wl-copy", "xclip"].includes(command);
	const [opener, ...rest] = clipboard ? ["clipboard"] : command === "xdg-open" ? ["open", ...args] : command === "rundll32" ? ["open", ...args.slice(1)] : [command, ...args];
	world.spawned.push(`spawn ${opener} ${rest.join(" ")}`);
	const child = new EventEmitter();
	void Promise.resolve().then(() => child.emit("exit", 0));
	// What a tool is fed on stdin (the clipboard) is part of the effect.
	const stdin = { on: () => stdin, end: (text?: string) => void (text !== undefined && world.spawned.push(`stdin ${text}`)) };
	return Object.assign(child, { stdin });
}
