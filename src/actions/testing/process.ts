import { EventEmitter } from "node:events";

import { world } from "./deck.js";

/** Stands in for `spawn`, so a key that opens T3 Code never launches anything: records the command and exits 0. */
export function spawn(command: string, args: readonly string[]) {
	world.spawned.push(`spawn ${command} ${args.join(" ")}`);
	const child = new EventEmitter();
	void Promise.resolve().then(() => child.emit("exit", 0));
	return Object.assign(child, { stdin: undefined });
}
