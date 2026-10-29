import type { DeckThread, ThreadBoard } from "../core/board.js";
import { threadCounts } from "../core/infobar.js";
import { approveKey, denyKey } from "../core/keys/decision.js";
import { effortKey, modelKey, permissionsKey, planKey, speedKey } from "../core/keys/power.js";
import { branchKey, forkKey, stopKey } from "../core/keys/lineage.js";
import { ORGANIZE_ACTIONS, organizeKey } from "../core/keys/organize.js";
import { activityKey, newThreadKey, threadKey } from "../core/keys/threads.js";
import type { KeyRuntime } from "../core/keys/key.js";
import { applyChoice, type DialControl, type PowerChoice, type PowerState, powerState, stepChoice, type UltrathinkControl } from "../core/power.js";
import { QUICK_PROMPTS } from "../core/prompts.js";
import { COLORS } from "../core/render.js";
import type { Machine } from "../core/t3/machine.js";
import type { LimitPool, LimitPoolWindow } from "../core/usage/limits.js";
import { limitGauge, machineLimitPools, tightestWindow } from "../core/usage/limitsView.js";
import { continueStep } from "./controls.js";
import type { KeyKind } from "./keys.js";
import { continueFace, customPromptFace, limitsFace, limitsLabel, PROMPT_GLYPHS, promptFace, ringFace, settingsFace, statusFace, statusLabel, stopAllFace, urgentFace, runningFace, waitingFace } from "./ring.js";
import { sharedKind } from "./shared.js";

/** What the sidecar's keys reach for beyond the board: the machines, opening things, the limits and config watches, and the shared keys' runtime. */
export type SidecarDeps = {
	machines(): readonly Machine[];
	board: ThreadBoard;
	open(thread: DeckThread): void;
	openExternal(url: string): Promise<void>;
	refreshLimits(): void;
	watchConfigs(): void;
	failed(what: string): (error: unknown) => void;
	settingsUrl(): string;
	runtime: KeyRuntime;
	warn(message: string): void;
};

export function sidecarKinds(deps: SidecarDeps): Record<string, KeyKind> {
	const { board, failed, open, watchConfigs } = deps;

	/** The thread open in T3 Code, which the prompt, Continue, access and effort actions act on, when its machine lets them. */
	const selected = () => {
		const thread = board.selectedOn();
		return thread?.machine.canOperate ? thread : undefined;
	};
	const isPrompt = (name: string): name is keyof typeof PROMPT_GLYPHS => Object.hasOwn(PROMPT_GLYPHS, name);
	type Thread = NonNullable<ReturnType<typeof selected>>;

	// Ultrathink only prefixes prompts Turnkey sends, and on Logitech you type yours in T3 Code, so it is never offered.
	const NO_ULTRATHINK: UltrathinkControl = { armed: false, arm: () => undefined, disarm: () => undefined };
	const sendPrompt = (thread: Thread, text: string) => thread.machine.send(thread, text, "auto");

	/** The model, effort or access choices for `thread`, without prompt-only efforts. */
	const powerOf = (thread: Thread, control: DialControl) => powerState(control, thread.machine.modelConfig, thread, false, { promptInjected: false });

	const CHANGE: Record<DialControl, string> = { model: "change the model", effort: "change the effort", permissions: "change the access mode" };

	/** Applies the choice `choose` picks from the thread's model, effort or access, unless it is the current one. */
	function pick(control: DialControl, choose: (state: PowerState) => PowerChoice | undefined): void {
		const thread = selected();
		if (thread === undefined) return;
		const state = powerOf(thread, control);
		const choice = choose(state);
		if (choice === undefined || choice.key === state.current?.key) return;
		void applyChoice(thread, choice, NO_ULTRATHINK)?.().catch(failed(CHANGE[control]));
	}

	type Limit = { percent: number; stale: boolean; driver: string; window: string };

	/** A pool's limit as a slot shows it: its tightest window, used. */
	function limitOf({ pool, window }: { pool: LimitPool; window: LimitPoolWindow }, now: number): Limit {
		const gauge = limitGauge(pool, window, now, "used");
		return { percent: gauge.percent, stale: gauge.stale, driver: pool.driver, window: gauge.label };
	}
	function tightestLimit(): Limit | undefined {
		const now = Date.now();
		const tightest = tightestWindow(machineLimitPools(deps.machines(), now));
		return tightest && limitOf(tightest, now);
	}
	/** The Limits folder's slots: the provider at `place`, from 1, in the order T3 Code's Limits lists them. */
	function limitAt(place: string): Limit | undefined {
		const now = Date.now();
		const pool = machineLimitPools(deps.machines(), now)[Number(place) - 1];
		const tightest = pool && tightestWindow([pool]);
		return tightest && limitOf(tightest, now);
	}

	const operable = () => board.threads.filter((thread) => thread.deck === "running" && thread.machine.canOperate);

	return {
		// Approve allows once, as the design has it on Logitech; a keypad holds for it, a Ring click is itself the confirmation.
		approve: sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, deps.runtime, deps.warn),
		deny: sharedKind("deny", denyKey, { "": {} }, deps.runtime, deps.warn),
		// Thread n is the nth thread on the board, the order Stream Deck's slot n shows with default settings.
		thread: sharedKind("thread", threadKey, Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((slot) => [String(slot), { slot }])), deps.runtime, deps.warn),
		activity: sharedKind("activity", activityKey, { "": {} }, deps.runtime, deps.warn),
		newThread: sharedKind("newThread", newThreadKey, { "": {} }, deps.runtime, deps.warn),
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
			label: () => selected()?.title,
			press: () => {
				const thread = selected();
				const step = continueStep(thread);
				if (thread && step === "open") open(thread);
				if (thread && step === "send") void sendPrompt(thread, QUICK_PROMPTS.continue.text).catch(failed("continue the thread"));
			},
		},
		// Access, Effort and Model n were Logitech actions before they were shared; they keep how they looked and acted.
		access: { ...sharedKind("access", permissionsKey, () => ({}), deps.runtime, deps.warn, { quiet: failed(CHANGE.permissions), glyphOnly: true }), turn: (ticks) => pick("permissions", (state) => stepChoice(state, undefined, ticks)) },
		effort: { ...sharedKind("effort", effortKey, () => ({}), deps.runtime, deps.warn, { quiet: failed(CHANGE.effort), glyphOnly: true }), turn: (ticks) => pick("effort", (state) => stepChoice(state, undefined, ticks)) },
		// A Models folder's slots: the parameter is the place, from 1, in T3 Code's picker (favorites, else every model).
		model: { ...sharedKind("model", modelKey, (place) => ({ pickerSlot: Number(place) }), deps.runtime, deps.warn, { quiet: failed(CHANGE.model), glyphOnly: true }), appear: watchConfigs },
		speed: sharedKind("speed", speedKey, { "": {} }, deps.runtime, deps.warn),
		plan: sharedKind("plan", planKey, { "": {} }, deps.runtime, deps.warn),
		limit: {
			face: (_index, place) => {
				const limit = limitAt(place);
				return limit ? limitsFace(limit.percent, limit.stale, limit.driver) : limitsFace(undefined, false);
			},
			label: (_index, place) => {
				const limit = limitAt(place);
				return limit && limitsLabel(limit.driver, limit.window, limit.percent);
			},
			appear: deps.refreshLimits,
			press: deps.refreshLimits,
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
			appear: deps.refreshLimits,
		},
		status: {
			face: () => statusFace(threadCounts(board.threads)),
			label: () => statusLabel(threadCounts(board.threads)),
			press: () => {
				const top = board.threads[0];
				if (top) open(top);
			},
		},
		// The Threads folder's halves; the board lists threads most urgent first, and running ones newest first.
		waiting: {
			face: () => waitingFace(board.threads),
			label: () => statusLabel(threadCounts(board.threads)),
			press: () => {
				const top = board.threads.find((thread) => thread.deck === "approval" || thread.deck === "question");
				if (top) open(top);
			},
		},
		running: {
			face: () => runningFace(board.threads),
			label: () => statusLabel(threadCounts(board.threads)),
			press: () => {
				const newest = board.threads.find((thread) => thread.deck === "running");
				if (newest) open(newest);
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
			label: () => board.threads[0]?.title,
			press: () => {
				const top = board.threads[0];
				if (top) open(top);
			},
		},
		// Logi shows the banner, and its button, only for a warning or an error: this is the way to the page once paired.
		settings: {
			face: settingsFace,
			press: () => void deps.openExternal(deps.settingsUrl()).catch(failed("open Turnkey Settings")),
		},
		// Stop run was a Logitech action before it was shared: the open thread if it runs, else the newest run, on any press, as it always acted.
		stop: sharedKind("stop", stopKey, () => ({ fallback: "newestRunning" }), deps.runtime, deps.warn, { quiet: failed("stop the run"), glyphOnly: true }),
		// Stop workflow and Merge can't be undone: a keypad holds for them, a Ring click is itself the confirmation.
		stopWorkflow: sharedKind("stopWorkflow", stopKey, { "": { mode: "workflow" } }, deps.runtime, deps.warn),
		fork: sharedKind("fork", forkKey, { "": {} }, deps.runtime, deps.warn),
		merge: sharedKind("merge", forkKey, { "": { mode: "merge" } }, deps.runtime, deps.warn),
		branch: sharedKind("branch", branchKey, { "": {} }, deps.runtime, deps.warn),
		// One action per organize action but Unpin; Snooze takes Stream Deck's default hour, and Pin toggles, as there.
		organize: sharedKind("organize", organizeKey, Object.fromEntries(ORGANIZE_ACTIONS.map((organize) => [organize, { organize }])), deps.runtime, deps.warn),
	};
}
