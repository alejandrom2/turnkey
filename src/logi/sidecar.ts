import { join } from "node:path";
import { createInterface } from "node:readline";

import { ThreadBoard } from "../core/board.js";
import { openExternal, openThread } from "../core/commands.js";
import { threadCounts } from "../core/infobar.js";
import { COLORS } from "../core/render.js";
import { findModel, modelColor } from "../core/models.js";
import { applyChoice, type DialControl, effortChoices, effortToneOf, type PowerChoice, type PowerState, powerState, stepChoice } from "../core/power.js";
import { QUICK_PROMPTS } from "../core/prompts.js";
import { limitGauge, machineLimitPools, tightestWindow } from "../core/usage/limitsView.js";
import { LimitsRefresher, refreshLimits } from "../core/usage/refresh.js";
import { Machines } from "../core/t3/machines.js";
import { UltrathinkArming, ultrathinkControl } from "../core/ultrathink.js";
import type { SocketLike } from "../core/t3/rpc.js";
import { batched } from "./batch.js";
import { HapticCues } from "./haptics.js";
import { Keys } from "./keys.js";
import { useLanguage } from "./language.js";
import { startPairingPage } from "./page.js";
import { encodeMessage, parseHostMessage, type SidecarMessage } from "./protocol.js";
import { continueStep, nextChoice } from "./controls.js";
import { continueFace, customPromptFace, effortFace, limitsFace, limitsLabel, modeFace, modelFace, PROMPT_GLYPHS, promptFace, ringFace, settingsFace, statusFace, statusLabel, stopAllFace, stopFace, stopTarget, urgentFace } from "./ring.js";
import { FileSettings } from "./settings.js";
import { throttled } from "./resync.js";
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

/** The thread open in T3 Code, which the prompt, Continue, access and effort actions act on, when its machine lets them. */
const selected = () => {
	const thread = board.selectedOn();
	return thread?.machine.canOperate ? thread : undefined;
};
const selectThread = (key: string, url: string) => board.select(key, url).catch(failed("select the thread"));
const open = (thread: Parameters<typeof openThread>[0]) => void openThread(thread, selectThread).catch(failed("open the thread"));
const isPrompt = (name: string): name is keyof typeof PROMPT_GLYPHS => Object.hasOwn(PROMPT_GLYPHS, name);

type Thread = NonNullable<ReturnType<typeof selected>>;

// Ultrathink is armed here in memory, per thread, as the Stream Deck does; the prompt kinds prefix it.
const arming = new UltrathinkArming(() => changed());
const modelOf = (thread: Thread) => findModel(thread.machine.modelConfig, thread.model);
const sendPrompt = (thread: Thread, text: string) => thread.machine.send(thread, arming.prompt(thread.key, modelOf(thread), text), "auto");

/** The model, effort or access choices for `thread`, Ultrathink included. */
const powerOf = (thread: Thread, control: DialControl) => powerState(control, thread.machine.modelConfig, thread, arming.armed(thread.key, modelOf(thread)));

/** The model at `place`, from 1, in the open thread's picker, and the thread's own model's key. */
function modelAt(place: string): { choice?: Extract<PowerChoice, { kind: "model" }>; current?: string } {
	const thread = selected();
	const state = thread && powerOf(thread, "model");
	const choice = state?.choices[Number(place) - 1];
	return { choice: choice?.kind === "model" ? choice : undefined, current: state?.current?.key };
}

const CHANGE: Record<DialControl, string> = { model: "change the model", effort: "change the effort", permissions: "change the access mode" };

/** Applies the choice `choose` picks from the thread's model, effort or access, unless it is the current one. */
function pick(control: DialControl, choose: (state: PowerState) => PowerChoice | undefined): void {
	const thread = selected();
	if (thread === undefined) return;
	const state = powerOf(thread, control);
	const choice = choose(state);
	if (choice === undefined || choice.key === state.current?.key) return;
	void applyChoice(thread, choice, ultrathinkControl(arming, thread.key, arming.armed(thread.key, modelOf(thread))))?.().catch(failed(CHANGE[control]));
}

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
function tightestLimit(): { percent: number; stale: boolean; driver: string; window: string } | undefined {
	const now = Date.now();
	const pools = machineLimitPools(machines.all, now);
	const tightest = tightestWindow(pools);
	if (tightest === undefined) return undefined;
	const gauge = limitGauge(tightest.pool, tightest.window, now, "used");
	return { percent: gauge.percent, stale: gauge.stale, driver: tightest.pool.driver, window: gauge.label };
}

const operable = () => board.threads.filter((thread) => thread.deck === "running" && thread.machine.canOperate);

const keys = new Keys(
	{
		prompt: {
			face: (_index, name) => (isPrompt(name) ? promptFace(name) : ringFace(COLORS.muted, "chat", { dim: true })),
			press: (_index, name) => {
				const thread = selected();
				if (thread && isPrompt(name)) void sendPrompt(thread, QUICK_PROMPTS[name].text).catch(failed("send the prompt"));
			},
		},
		// A prompt written in the action's editor travels as its parameter, so each placed copy is its own key.
		send: {
			face: (_index, text) => customPromptFace(text.trim() !== ""),
			press: (_index, text) => {
				const thread = selected();
				if (thread && text.trim()) void sendPrompt(thread, text.trim()).catch(failed("send the prompt"));
			},
		},
		continue: {
			face: () => continueFace(continueStep(selected())),
			press: () => {
				const thread = selected();
				const step = continueStep(thread);
				if (thread && step === "open") open(thread);
				if (thread && step === "send") void sendPrompt(thread, QUICK_PROMPTS.continue.text).catch(failed("continue the thread"));
			},
		},
		access: {
			face: () => modeFace(selected()?.runtimeMode),
			press: () => pick("permissions", nextChoice),
			turn: (ticks) => pick("permissions", (state) => stepChoice(state, undefined, ticks)),
		},
		effort: {
			face: () => {
				const thread = selected();
				const state = thread && powerOf(thread, "effort");
				if (thread === undefined || state === undefined || state.choices.length < 2) return effortFace(undefined);
				const index = Math.max(state.choices.findIndex((choice) => choice.key === state.current?.key), 0);
				const model = modelOf(thread);
				// Stream Deck's default effort colors, as Logi has no Colors setting.
				const tone = effortToneOf(effortChoices(model), state.current?.key, "gradient", model && modelColor(model));
				const current = state.current;
				return effortFace({ index, count: state.choices.length, color: tone?.text ?? COLORS.accent, ultrathink: current?.kind === "effort" && current.ultrathink });
			},
			press: () => pick("effort", nextChoice),
			turn: (ticks) => pick("effort", (state) => stepChoice(state, undefined, ticks)),
		},
		// A Models folder's slots: the parameter is the place, from 1, in T3 Code's picker (favorites, else every model).
		model: {
			face: (_index, place) => {
				const { choice, current } = modelAt(place);
				return modelFace(choice?.model, choice !== undefined && choice.key === current);
			},
			label: (_index, place) => modelAt(place).choice?.model.label,
			press: (_index, place) => pick("model", (state) => state.choices[Number(place) - 1]),
			appear: watchConfigs,
		},
		limits: {
			face: () => {
				const limit = tightestLimit();
				return limitsFace(limit?.percent, limit?.stale ?? false);
			},
			label: () => {
				const limit = tightestLimit();
				return limit && limitsLabel(limit.driver, limit.window, limit.percent);
			},
			appear: showLimits,
		},
		status: {
			face: () => statusFace(threadCounts(board.threads)),
			label: () => statusLabel(threadCounts(board.threads)),
			press: () => {
				const top = board.threads[0];
				if (top) open(top);
			},
		},
		stopAll: {
			face: () => stopAllFace(operable().length),
			press: () => {
				for (const thread of operable()) void thread.machine.stopRun(thread).catch(failed("stop a run"));
			},
		},
		urgent: {
			face: () => urgentFace(board.threads),
			press: () => {
				const top = board.threads[0];
				if (top) open(top);
			},
		},
		// Logi shows the banner, and its button, only for a warning or an error: this is the way to the page once paired.
		settings: {
			face: settingsFace,
			press: () => void openExternal(page.url).catch(failed("open Turnkey Settings")),
		},
		stop: {
			face: () => stopFace(stopTarget(board.threads, board.selectedOn())?.machine.canOperate === true),
			press: () => {
				const target = stopTarget(board.threads, board.selectedOn());
				if (target?.machine.canOperate) void target.machine.stopRun(target).catch(failed("stop the run"));
			},
		},
	},
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
