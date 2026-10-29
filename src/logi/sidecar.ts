import { join } from "node:path";
import { createInterface } from "node:readline";

import { ThreadBoard } from "../core/board.js";
import { openExternal, openThread } from "../core/commands.js";
import { LimitsRefresher, refreshLimits } from "../core/usage/refresh.js";
import { Machines } from "../core/t3/machines.js";
import type { SocketLike } from "../core/t3/rpc.js";
import { batched } from "./batch.js";
import { HapticCues } from "./haptics.js";
import { sidecarKinds } from "./kinds.js";
import { Keys } from "./keys.js";
import { useLanguage } from "./language.js";
import { startPairingPage } from "./page.js";
import { encodeMessage, parseHostMessage, type SidecarMessage } from "./protocol.js";
import { FileSettings } from "./settings.js";
import { throttled } from "./resync.js";
import { logiRuntime } from "./runtime.js";
import { keptMachines, machineRows } from "./rows.js";
import { pluginStatus, waitsForSync } from "./status.js";
import { FileCredentials } from "./store.js";

// Run by the Logitech plugin as `sidecar.mjs <dataDir>`.
const [dataDir] = process.argv.slice(2);
if (dataDir === undefined) {
	process.stderr.write("usage: sidecar.mjs <dataDir>\n");
	process.exit(2);
}

const store = new FileCredentials(join(dataDir, "credentials.json"));
const settings = new FileSettings(join(dataDir, "settings.json"));
// stdout is the channel to the plugin, so logging goes through it as messages.
const send = (message: SidecarMessage) => process.stdout.write(encodeMessage(message));
const log = (level: "info" | "warn", message: string) => send({ type: "log", level, message });
// As the Stream Deck plugin does, so a stray rejection is logged instead of ending the sidecar.
process.on("unhandledRejection", (reason) => log("warn", `Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`));

// Node's WebSocket types its handlers with DOM events; the client only reads `data` from them.
const machines = new Machines(
	store,
	{
		fetch,
		socket: (url) => new WebSocket(url) as unknown as SocketLike,
		clientLabel: "Turnkey (Logitech)",
		warn: (url, message) => log("warn", `${new URL(url).host}: ${message}`),
	},
	() => changed(),
);

const board = new ThreadBoard(() => machines.all);
const failed = (what: string) => (error: unknown) => log("warn", `Couldn't ${what}: ${error instanceof Error ? error.message : String(error)}`);

const selectThread = (key: string, url: string) => board.select(key, url).catch(failed("select the thread"));
const open = (thread: Parameters<typeof openThread>[0]) => void openThread(thread, selectThread).catch(failed("open the thread"));

/**
 * Limits keep each machine on T3 Code's config subscription once a Limits slot has shown, and refresh when the ring
 * shows them, through T3 Code's five-minute throttle; nothing polls while the ring is closed.
 */
const refresher = new LimitsRefresher();
const watchingConfig = new Set<string>();
const ready = () => machines.all.filter((each) => each.state.kind === "ready" && each.environmentId !== undefined);
/** Keeps each machine's config live (limits, models and favorites) once a slot that shows it has appeared. */
function watchConfigs(): void {
	for (const each of ready()) {
		// shortcut: held until the sidecar exits, since Logi never says a slot is hidden; release it if Logi adds that.
		if (!watchingConfig.has(each.url)) {
			watchingConfig.add(each.url);
			each.watchConfig();
		}
	}
}
function showLimits(): void {
	watchConfigs();
	for (const each of ready()) void refreshLimits(refresher, each, true).then(changed, failed("refresh limits"));
}
const keys = new Keys(
	sidecarKinds({
		board,
		open,
		openExternal,
		refreshLimits: showLimits,
		watchConfigs,
		failed,
		settingsUrl: () => page.url,
		// `changed` is declared below; the runtime only calls it once keys exist.
		runtime: logiRuntime({ machines: () => machines.all, board, openThread: (thread) => openThread(thread, selectThread), selectThread: (thread) => void selectThread(thread.key, thread.machine.url), repaint: () => changed(), warn: (message) => log("warn", message) }),
		warn: (message) => log("warn", message),
	}),
	send,
);
// Cues keep following threads while haptics are off, so turning them on doesn't buzz for old changes.
const haptics = new HapticCues((message) => settings.haptics && send(message));
const changed = batched(
	() => {
		board.update();
		haptics.update(board.threads);
		keys.repaint();
		sendStatus();
	},
	(error) => log("warn", `Couldn't update the keys: ${error instanceof Error ? error.message : String(error)}`),
);

/** Machines removed on the settings page, until they pair again; others stay listed when their pairing ends. */
const removed = new Set<string>();
const kept = () => keptMachines(store.urls(), machines.all.map((each) => each.url), removed);

/** Spends a pair link from the pairing page and returns the label T3 Code gave the pairing. */
async function pairLink(link: string): Promise<string> {
	const { url, credential } = await machines.pair(link);
	removed.delete(url);
	return credential.label;
}

/** Forgets a machine here; T3 Code keeps the pairing listed under Sharing & access until it's revoked there. */
async function removeMachine(url: string): Promise<void> {
	await machines.get(url)?.signOut();
	removed.add(url);
	await machines.sync(kept);
}

const page = await startPairingPage({
	pair: pairLink,
	machines: () => machineRows(machines.all, (url) => store.load(url)?.label),
	remove: removeMachine,
	haptics: () => settings.haptics,
	setHaptics: (on) => settings.setHaptics(on),
});
let lastStatus = "";
let synced = false;
function sendStatus(): void {
	if (waitsForSync(store.urls().length, synced)) return;
	const status = pluginStatus(machines.all.map((each) => each.state), page.url);
	const line = JSON.stringify(status);
	if (line === lastStatus) return;
	lastStatus = line;
	send(status);
}

// At startup, then only when a key shows and no machine is ready: a lost T3 Code, or one that moved port, is found again without polling.
const resync = throttled(
	() =>
		void machines
			.sync(kept)
			.then(() => machines.wake())
			.catch(failed("look for T3 Code"))
			.finally(() => {
				synced = true;
				changed();
			}),
	10_000,
);
resync();
// With no machine yet, nothing else would show the banner asking for a pair link.
changed();

const input = createInterface({ input: process.stdin });
input.on("line", (line) => {
	const message = parseHostMessage(line);
	if (message === undefined) return log("warn", "Dropped a line that isn't a host message.");
	if (message.type !== "language") {
		if (message.type === "appear" && ready().length === 0) resync();
		return keys.handle(message);
	}
	useLanguage(message.language);
	// The banner is worded in the old language; the pairing page reads the new one on its next load.
	lastStatus = "";
	changed();
});
// The plugin closing stdin is the signal to quit.
input.on("close", () => {
	page.close();
	for (const each of machines.all) each.stop();
	process.exit(0);
});
