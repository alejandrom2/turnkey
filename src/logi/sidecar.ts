import { join } from "node:path";
import { createInterface } from "node:readline";

import { ThreadBoard } from "../core/board.js";
import { openExternal, threadDeepLink } from "../core/commands.js";
import { Machine } from "../core/t3/machine.js";
import { findLocalEnvironment, parsePairingLink, preferLoopback } from "../core/t3/pairing.js";
import type { SocketLike } from "../core/t3/rpc.js";
import { batched } from "./batch.js";
import { HapticCues } from "./haptics.js";
import { Keys } from "./keys.js";
import { encodeMessage, parseHostMessage, type SidecarMessage } from "./protocol.js";
import { stopFace, stopTarget, urgentFace } from "./ring.js";
import { FileCredentials } from "./store.js";

// Run by the Logitech plugin as `sidecar.js <dataDir>`, or once by hand as `sidecar.js <dataDir> pair <link>`.
const [dataDir, command, link] = process.argv.slice(2);
if (dataDir === undefined) {
	process.stderr.write("usage: sidecar.js <dataDir> [pair <link>]\n");
	process.exit(2);
}

const store = new FileCredentials(join(dataDir, "credentials.json"));
// stdout is the channel to the plugin, so logging goes through it as messages.
const send = (message: SidecarMessage) => process.stdout.write(encodeMessage(message));
const log = (level: "info" | "warn", message: string) => send({ type: "log", level, message });

const machines = new Map<string, Machine>();
const board = new ThreadBoard(() => [...machines.values()]);
const failed = (what: string) => (error: unknown) => log("warn", `Couldn't ${what}: ${error instanceof Error ? error.message : String(error)}`);
const keys = new Keys(
	{
		urgent: {
			face: () => urgentFace(board.threads),
			press: () => {
				const top = board.threads[0];
				if (top) void openExternal(threadDeepLink(top)).catch(failed("open the thread"));
			},
		},
		stop: {
			face: () => stopFace(stopTarget(board.threads)?.machine.canOperate === true),
			press: () => {
				const target = stopTarget(board.threads);
				if (target?.machine.canOperate) void target.machine.stopRun(target).catch(failed("stop the run"));
			},
		},
	},
	send,
);
const haptics = new HapticCues(send);
const changed = batched(
	() => {
		board.update();
		haptics.update(board.threads);
		keys.repaint();
	},
	(error) => log("warn", `Couldn't update the keys: ${error instanceof Error ? error.message : String(error)}`),
);

function machine(url: string): Machine {
	const existing = machines.get(url);
	if (existing) return existing;
	// Node's WebSocket types its handlers with DOM events; the client only reads `data` from them.
	const socket = (socketUrl: string) => new WebSocket(socketUrl) as unknown as SocketLike;
	const created = new Machine(url, store, { fetch, socket, clientLabel: "Turnkey (Logitech)", warn: (message) => log("warn", `${new URL(url).host}: ${message}`) }, changed);
	machines.set(url, created);
	return created;
}

if (command === "pair") {
	const parsed = link === undefined ? undefined : parsePairingLink(link);
	if (parsed === undefined) {
		process.stderr.write("That isn't a T3 Code pair link.\n");
		process.exit(1);
	}
	try {
		const credential = await machine(preferLoopback(parsed.url)).pair(parsed.code);
		process.stderr.write(`Paired with ${credential.label}.\n`);
		process.exit(0);
	} catch (error) {
		process.stderr.write(`Couldn't pair: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exit(1);
	}
}

const local = await findLocalEnvironment(fetch);
for (const url of new Set([...store.urls(), ...(local ? [local.url] : [])])) machine(url).start();

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
	const message = parseHostMessage(line);
	if (message === undefined) return log("warn", "Dropped a line that isn't a host message.");
	keys.handle(message);
});
// The plugin closing stdin is the signal to quit.
input.on("close", () => {
	for (const each of machines.values()) each.stop();
	process.exit(0);
});
