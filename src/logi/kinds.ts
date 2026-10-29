import type { DeckThread, ThreadBoard } from "../core/board.js";
import { threadCounts } from "../core/infobar.js";
import { approveKey, denyKey } from "../core/keys/decision.js";
import { gitKey } from "../core/keys/git.js";
import { pullRequestKey } from "../core/keys/pr.js";
import { effortKey, modelKey, permissionsKey, planKey, speedKey } from "../core/keys/power.js";
import { branchKey, forkKey, stopKey } from "../core/keys/lineage.js";
import { healthKey } from "../core/keys/health.js";
import { openKey } from "../core/keys/open.js";
import { ORGANIZE_ACTIONS, organizeKey } from "../core/keys/organize.js";
import { limitsKey } from "../core/keys/limits.js";
import { sendKey } from "../core/keys/prompt.js";
import { shareKey } from "../core/keys/share.js";
import { createUpdateKey } from "../core/keys/update.js";
import { readShown, usageKey } from "../core/keys/usage.js";
import { activityTile, continueTile, settingsTile, statusTile, stopAllTile } from "../core/keys/logi.js";
import { activityKey, newThreadKey, threadKey } from "../core/keys/threads.js";
import type { KeyRuntime } from "../core/keys/key.js";
import { applyChoice, type DialControl, type PowerChoice, type PowerState, powerState, stepChoice, type UltrathinkControl } from "../core/power.js";
import { QUICK_PROMPTS } from "../core/prompts.js";
import { usagePeriod } from "../core/usage/store.js";
import { continueStep } from "./controls.js";
import type { KeyKind } from "./keys.js";
import { continueFace, PROMPT_GLYPHS, settingsFace, statusFace, statusLabel, stopAllFace, urgentFace, runningFace, waitingFace } from "./ring.js";
import { markup, sharedKind } from "./shared.js";

/** What the sidecar's keys reach for beyond the board: opening things, the limits and config watches, and the shared keys' runtime. */
export type SidecarDeps = {
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

	// Limit n and the Limits folder were Logitech actions before they were shared: same Ring faces, and a press only refreshes, as it always did.
	const limitsQuiet = { quiet: failed("refresh limits") };
	const { press: _folderPress, ...limitsFolder } = sharedKind("limits", limitsKey, () => ({}), deps.runtime, deps.warn, limitsQuiet);

	// Update's runs live with this host; how one ended flashes on its key, after the press.
	const updateKey = createUpdateKey();
	const update = sharedKind("update", updateKey, { "": {} }, deps.runtime, deps.warn);
	updateKey.onResult((_url, label) => update.flash("", label));

	const operable = () => board.threads.filter((thread) => thread.deck === "running" && thread.machine.canOperate);
	// What Most urgent, Waiting and Running open, so a keypad tile shows the thread a press opens.
	const firstWaiting = () => board.threads.find((thread) => thread.deck === "approval" || thread.deck === "question");
	const newestRunning = () => board.threads.find((thread) => thread.deck === "running");
	/** The Ring's glyph at 80 px or less, the tile on a keypad. */
	const sized = (size: number, glyph: () => string, tile: () => string) => (size <= 80 ? glyph() : markup(tile()));

	return {
		// Approve allows once, as the design has it on Logitech; a keypad holds for it, a Ring click is itself the confirmation.
		approve: sharedKind("approve", approveKey, { "": { approvalAuthority: "once" } }, deps.runtime, deps.warn),
		deny: sharedKind("deny", denyKey, { "": {} }, deps.runtime, deps.warn),
		// Thread n is the nth thread on the board, the order Stream Deck's slot n shows with default settings.
		thread: sharedKind("thread", threadKey, Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8].map((slot) => [String(slot), { slot }])), deps.runtime, deps.warn),
		activity: sharedKind("activity", activityKey, { "": {} }, deps.runtime, deps.warn),
		newThread: sharedKind("newThread", newThreadKey, { "": {} }, deps.runtime, deps.warn),
		// Prompt n and Send were Logitech actions before they were shared: they keep their Ring faces and how they acted, sending at once.
		// A name with no glyph of its own (Continue is its own action) sends nothing, as before.
		prompt: sharedKind("prompt", sendKey, (name) => (isPrompt(name) ? { template: name } : {}), deps.runtime, deps.warn, { quiet: failed("send the prompt") }),
		// A prompt written in the action's editor travels as its parameter, so each placed copy is its own key.
		send: sharedKind("send", sendKey, (text) => ({ template: "custom", prompt: text }), deps.runtime, deps.warn, { quiet: failed("send the prompt") }),
		continue: {
			face: (_index, _parameter, size) => sized(size, () => continueFace(continueStep(selected())), () => continueTile(continueStep(selected()), selected()?.deck)),
			label: () => selected()?.title,
			press: () => {
				const thread = selected();
				const step = continueStep(thread);
				if (thread && step === "open") open(thread);
				if (thread && step === "send") void sendPrompt(thread, QUICK_PROMPTS.continue.text).catch(failed("continue the thread"));
			},
		},
		// Access, Effort and Model n were Logitech actions before they were shared; they keep their Ring faces and how they acted.
		access: { ...sharedKind("access", permissionsKey, () => ({}), deps.runtime, deps.warn, { quiet: failed(CHANGE.permissions) }), turn: (ticks) => pick("permissions", (state) => stepChoice(state, undefined, ticks)) },
		effort: { ...sharedKind("effort", effortKey, () => ({}), deps.runtime, deps.warn, { quiet: failed(CHANGE.effort) }), turn: (ticks) => pick("effort", (state) => stepChoice(state, undefined, ticks)) },
		// A Models folder's slots: the parameter is the place, from 1, in T3 Code's picker (favorites, else every model).
		model: { ...sharedKind("model", modelKey, (place) => ({ pickerSlot: Number(place) }), deps.runtime, deps.warn, { quiet: failed(CHANGE.model) }), appear: watchConfigs },
		speed: sharedKind("speed", speedKey, { "": {} }, deps.runtime, deps.warn),
		plan: sharedKind("plan", planKey, { "": {} }, deps.runtime, deps.warn),
		// A Limits folder's slots: the parameter is the place, from 1, in T3 Code's Limits.
		limit: { ...sharedKind("limit", limitsKey, (place) => ({ poolSlot: Number(place) }), deps.runtime, deps.warn, limitsQuiet), appear: deps.refreshLimits, press: deps.refreshLimits },
		limits: { ...limitsFolder, appear: deps.refreshLimits },
		status: {
			face: (_index, _parameter, size) => sized(size, () => statusFace(threadCounts(board.threads)), () => statusTile(threadCounts(board.threads))),
			label: () => statusLabel(threadCounts(board.threads)),
			press: () => {
				const top = board.threads[0];
				if (top) open(top);
			},
		},
		// The Threads folder's halves; the board lists threads most urgent first, and running ones newest first.
		waiting: {
			face: (_index, _parameter, size) => sized(size, () => waitingFace(board.threads), () => activityTile(deps.runtime, firstWaiting())),
			label: () => statusLabel(threadCounts(board.threads)),
			press: () => {
				const top = firstWaiting();
				if (top) open(top);
			},
		},
		running: {
			face: (_index, _parameter, size) => sized(size, () => runningFace(board.threads), () => activityTile(deps.runtime, newestRunning())),
			label: () => statusLabel(threadCounts(board.threads)),
			press: () => {
				const newest = newestRunning();
				if (newest) open(newest);
			},
		},
		stopAll: {
			face: (_index, _parameter, size) => sized(size, () => stopAllFace(operable().length), () => stopAllTile(operable().length)),
			press: () => {
				for (const thread of operable()) void thread.machine.stopRun(thread).catch(failed("stop a run"));
			},
		},
		urgent: {
			face: (_index, _parameter, size) => sized(size, () => urgentFace(board.threads), () => activityTile(deps.runtime, board.threads[0])),
			label: () => board.threads[0]?.title,
			press: () => {
				const top = board.threads[0];
				if (top) open(top);
			},
		},
		// Logi shows the banner, and its button, only for a warning or an error: this is the way to the page once paired.
		settings: {
			face: (_index, _parameter, size) => sized(size, settingsFace, settingsTile),
			press: () => void deps.openExternal(deps.settingsUrl()).catch(failed("open Turnkey Settings")),
		},
		// Stop run was a Logitech action before it was shared: the open thread if it runs, else the newest run, on any press, as it always acted.
		stop: sharedKind("stop", stopKey, () => ({ fallback: "newestRunning" }), deps.runtime, deps.warn, { quiet: failed("stop the run") }),
		// Stop workflow and Merge can't be undone: a keypad holds for them, a Ring click is itself the confirmation.
		stopWorkflow: sharedKind("stopWorkflow", stopKey, { "": { mode: "workflow" } }, deps.runtime, deps.warn),
		fork: sharedKind("fork", forkKey, { "": {} }, deps.runtime, deps.warn),
		merge: sharedKind("merge", forkKey, { "": { mode: "merge" } }, deps.runtime, deps.warn),
		branch: sharedKind("branch", branchKey, { "": {} }, deps.runtime, deps.warn),
		// One action per organize action but Unpin; Snooze takes Stream Deck's default hour, and Pin toggles, as there.
		organize: sharedKind("organize", organizeKey, Object.fromEntries(ORGANIZE_ACTIONS.map((organize) => [organize, { organize }])), deps.runtime, deps.warn),
		// In the Turnkey folder only, as their reads are heavier. Every git action needs a keypad hold; T3 Code writes the commit message.
		git: sharedKind("git", gitKey, Object.fromEntries((["commit", "push", "create_pr", "pull"] as const).map((gitAction) => [gitAction, { gitAction }])), deps.runtime, deps.warn),
		// Show is `pr`; of the handoffs only Fix findings needs a keypad hold, as Stream Deck holds it by default.
		pr: sharedKind("pr", pullRequestKey, { pr: { mode: "show" }, fix: { mode: "fix" }, explain: { mode: "explain" }, ask: { mode: "ask" }, guide: { mode: "guide" } }, deps.runtime, deps.warn),
		// The machines' configs (editors, providers, versions, Labs flags) stay live once these show. Preview and Health are in the folder only.
		open: { ...sharedKind("open", openKey, { editor: { mode: "editor" }, preview: { mode: "preview" } }, deps.runtime, deps.warn), appear: watchConfigs },
		health: { ...sharedKind("health", healthKey, { "": {} }, deps.runtime, deps.warn), appear: watchConfigs },
		// Update can't be undone: a keypad holds for it, a Ring click is itself the confirmation. Logitech never asks for its access.
		update: { ...update, appear: watchConfigs },
		share: { ...sharedKind("share", shareKey, { "": {} }, deps.runtime, deps.warn), appear: watchConfigs },
		// No minute tick here: the period is read as the key shows, unless it was read in the last minute, and on a press.
		usage: {
			...sharedKind("usage", usageKey, { "": {} }, deps.runtime, deps.warn),
			appear: () => {
				watchConfigs();
				readShown(deps.runtime, undefined, usagePeriod(undefined));
			},
		},
	};
}
