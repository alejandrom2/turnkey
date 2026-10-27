import { type Action, action, type KeyDownEvent, type KeyUpEvent, type WillDisappearEvent } from "@elgato/streamdeck";

import { HOLD_CONFIRM_MS } from "../core/approvals.js";
import { availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { openExternal, threadDeepLink } from "../core/commands.js";
import { t } from "../core/i18n.js";
import { mergeBlocked } from "../core/lineage.js";
import { modeOf } from "../core/modes.js";
import { QUICK_PROMPTS } from "../core/prompts.js";
import { renderControlKey, renderInfoKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import type { Machine } from "../core/t3/machine.js";
import { RpcError } from "../core/t3/rpc.js";
import { pinnedName } from "../core/target.js";
import { canStopWorkflows } from "../core/workflows.js";
import { deck } from "../deck.js";
import { canOperate, connectionFace, DeckAction, pressWhileDisconnected, selectThread, sendToThread } from "./base.js";
import { threadNeeds } from "./needs.js";

const ID = "com.alejandrom2.t3deck";

type TargetedSettings = { machine?: string; target?: string; thread?: string; threadTitle?: string; mode?: string };

/** The driver behind the thread's provider instance (`claudeAgent`, `codex`, …). */
const driverOf = (thread: DeckThread): string | undefined =>
	thread.machine.modelConfig?.providers?.find((provider) => provider.instanceId === thread.model.instanceId)?.driver;

/** "3 subagents" while the thread has any out. */
const subagentLine = (thread: DeckThread | undefined): string | undefined =>
	thread !== undefined && thread.subagents > 0 ? t(thread.subagents === 1 ? "status.subagent" : "status.subagents", { count: thread.subagents }) : undefined;

/** A key aimed at the selected thread or one pinned thread, with a hold to act: lineage changes can't be undone from the deck. */
abstract class LineageKey extends DeckAction<TargetedSettings> {
	protected pinnedNeed(action: Action<TargetedSettings>, thread: DeckThread | undefined): Need[] {
		const target = this.target(action);
		return threadNeeds(this.machineOf(action), thread, true, target.pinned ? pinnedName(this.settingsOf(action)) : undefined);
	}

	override onKeyDown(ev: KeyDownEvent<TargetedSettings>): void {
		this.pressStarted(ev.action.id);
	}
}

/** How long Stop offers to resume the thread it just stopped. */
export const RESUME_MS = 30_000;

/**
 * Stops the target thread's turn, or the workflows it runs as T3 Code's Lineage panel does for Claude's
 * provider-native workflows (its Stops setting). For a while after the deck stops a turn, it offers to resume it by
 * sending "Continue". Hold to stop a workflow: a stopped workflow can't be resumed.
 */
abstract class StopAction extends LineageKey {
	/** The thread each key stopped; `idle` once the deck has seen its turn end, since the stop lands a moment after it resolves. */
	readonly #resume = new Map<string, { key: string; idle: boolean; timer: ReturnType<typeof setTimeout> }>();

	#workflows(action: Action<TargetedSettings>): boolean {
		return modeOf("stop", this.manifestId, this.settingsOf(action)) === "workflow";
	}

	#turnState(action: Action<TargetedSettings>) {
		const { thread, gone, pinned } = this.target(action);
		return { thread, pinned, check: availability("stop", { thread, gone, canOperate: canOperate(thread) }) };
	}

	#workflowState(action: Action<TargetedSettings>) {
		const { thread, gone, pinned } = this.target(action);
		const missing = thread !== undefined && !canStopWorkflows(driverOf(thread)) ? t("workflow.notClaude") : undefined;
		return { thread, pinned, check: availability("workflow", { thread, gone, canOperate: canOperate(thread), missing }) };
	}

	/** The stopped thread this key may resume: still its target and not running again. */
	#resumable(action: Action<TargetedSettings>): DeckThread | undefined {
		const resume = this.#resume.get(action.id);
		if (resume === undefined) return undefined;
		const thread = this.target(action).thread;
		if (thread?.key === resume.key && thread.active && !resume.idle) return undefined;
		if (thread?.key === resume.key && !thread.active && canOperate(thread)) {
			resume.idle = true;
			return thread;
		}
		this.#endResume(action.id);
		return undefined;
	}

	#endResume(id: string): void {
		clearTimeout(this.#resume.get(id)?.timer);
		this.#resume.delete(id);
	}

	override needs(action: Action<TargetedSettings>): Need[] {
		if (!this.#workflows(action)) {
			const { thread } = this.#turnState(action);
			return [...this.pinnedNeed(action, thread), { kind: "running", ok: thread?.active === true }];
		}
		const { thread } = this.#workflowState(action);
		return [...this.pinnedNeed(action, thread), { kind: "option", option: t("workflow.option"), ok: thread !== undefined && canStopWorkflows(driverOf(thread)) }];
	}

	protected override async paint(action: Action<TargetedSettings>): Promise<void> {
		if (!action.isKey()) return;
		if (this.#workflows(action)) {
			this.#endResume(action.id);
			const offline = connectionFace(this.machineOf(action));
			if (offline) return void (await this.setImage(action, offline));
			const { thread, pinned, check } = this.#workflowState(action);
			const detail = check.available ? (subagentLine(thread) ?? thread?.title) : check.reason;
			return void (await this.setImage(action, renderInfoKey({ glyph: "workflow", title: t("workflow.stop"), detail, available: check.available, pinned })));
		}
		const { check, pinned } = this.#turnState(action);
		if (this.#resumable(action)) return void (await this.setImage(action, renderControlKey({ glyph: "play", primary: true, pinned })));
		await this.setImage(action, renderControlKey({ glyph: "stop", primary: true, available: check.available, pinned }));
	}

	override async onKeyUp(ev: KeyUpEvent<TargetedSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		if (this.#workflows(ev.action)) return this.#stopWorkflows(ev.action, held);
		const resumable = this.#resumable(ev.action);
		if (resumable !== undefined) {
			this.#endResume(ev.action.id);
			return void (await this.run(ev.action, () => sendToThread(resumable, QUICK_PROMPTS.continue.text, "auto")));
		}
		const { thread, check } = this.#turnState(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		await this.run(ev.action, async () => {
			await thread!.machine.stopRun(thread!);
			this.#endResume(ev.action.id);
			const id = ev.action.id;
			this.#resume.set(id, {
				key: thread!.key,
				idle: false,
				timer: setTimeout(() => {
					this.#resume.delete(id);
					void this.paint(ev.action);
				}, RESUME_MS),
			});
		});
	}

	async #stopWorkflows(action: Action<TargetedSettings>, held: number): Promise<void> {
		const { thread, check } = this.#workflowState(action);
		if (!(await this.allowed(action, check))) return;
		if (held < HOLD_CONFIRM_MS) return void (await this.flash(action, false, t("workflow.holdToStop")));
		const target = thread!;
		await this.run(action, async () => {
			const workflows = await target.machine.workflows(target);
			if (workflows.length === 0) throw new RpcError("NoWorkflow", "No workflow is running.", t("workflow.none"));
			for (const workflow of workflows) await target.machine.stopWorkflow(target, workflow.id);
		});
	}

	override onWillDisappear(ev: WillDisappearEvent<TargetedSettings>): void {
		this.#endResume(ev.action.id);
		super.onWillDisappear(ev);
	}
}

@action({ UUID: `${ID}.stop` })
export class Stop extends StopAction {}

/** Stop Workflow, which Stop's Stops setting replaced: hidden from the actions list, still on decks and in older profiles. */
@action({ UUID: `${ID}.workflow.stop` })
export class StopWorkflowKey extends StopAction {}

/** Selects a thread the shell may not list yet and opens it in the desktop app, as T3 Code navigates after a fork or merge. */
async function openNew(machine: Machine, threadId: string): Promise<void> {
	const environmentId = machine.environmentId;
	if (environmentId === undefined) return;
	selectThread({ key: `${environmentId}/${threadId}`, machine });
	await openExternal(threadDeepLink({ environmentId, threadId }, deck.scheme));
}

/**
 * Forks the target thread from its newest finished turn, as T3 Code's fork button does, then opens the fork; or merges
 * a fork back into the thread it came from, as T3 Code's Merge in the Lineage panel does, then opens that thread (its
 * Does setting). Hold to merge: the parent's conversation takes the fork's in.
 */
abstract class ForkAction extends LineageKey {
	#merges(action: Action<TargetedSettings>): boolean {
		return modeOf("fork", this.manifestId, this.settingsOf(action)) === "merge";
	}

	#forkState(action: Action<TargetedSettings>) {
		const { thread, gone, pinned } = this.target(action);
		const missing = thread !== undefined && thread.latestRunId === null ? t("lineage.nothingToFork") : undefined;
		return { thread, pinned, check: availability("lineage", { thread, gone, canOperate: canOperate(thread), missing }) };
	}

	#mergeState(action: Action<TargetedSettings>) {
		const { thread, gone, pinned } = this.target(action);
		// An archived parent leaves the shell but still takes the merge, so it is only named when listed.
		const parent = thread?.mergeInto === undefined ? undefined : (thread.machine.threadRow(thread.mergeInto) ?? undefined);
		const missing =
			thread === undefined
				? undefined
				: thread.mergeInto === undefined
					? t("lineage.notFork")
					: thread.latestRunId === null
						? t("lineage.finishRunFirst")
						: mergeBlocked(thread.runStatus)
							? t("lineage.finishTurn")
							: undefined;
		return { thread, pinned, parent, check: availability("lineage", { thread, gone, canOperate: canOperate(thread), missing }) };
	}

	override needs(action: Action<TargetedSettings>): Need[] {
		if (this.#merges(action)) {
			const { thread } = this.#mergeState(action);
			return [...this.pinnedNeed(action, thread), { kind: "value", value: t("lineage.aFork"), ok: thread?.mergeInto !== undefined }];
		}
		const { thread } = this.#forkState(action);
		return [...this.pinnedNeed(action, thread), { kind: "value", value: t("lineage.aFinishedTurn"), ok: thread !== undefined && thread.latestRunId !== null }];
	}

	protected override async paint(action: Action<TargetedSettings>): Promise<void> {
		if (!action.isKey()) return;
		const offline = connectionFace(this.machineOf(action));
		if (offline) return void (await this.setImage(action, offline));
		if (this.#merges(action)) {
			const { pinned, parent, check } = this.#mergeState(action);
			const detail = check.available ? (parent ? t("lineage.into", { thread: parent.title }) : undefined) : check.reason;
			return void (await this.setImage(action, renderInfoKey({ glyph: "mergeBack", title: t("lineage.mergeBack"), detail, available: check.available, pinned })));
		}
		const { pinned, check } = this.#forkState(action);
		await this.setImage(action, renderControlKey({ glyph: "fork", label: check.available ? t("lineage.fork") : check.reason, available: check.available, pinned, shrink: !check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent<TargetedSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		if (this.#merges(ev.action)) {
			const { thread, check } = this.#mergeState(ev.action);
			if (!(await this.allowed(ev.action, check))) return;
			if (held < HOLD_CONFIRM_MS) return void (await this.flash(ev.action, false, t("lineage.holdToMerge")));
			const fork = thread!;
			const into = fork.mergeInto!;
			return void (await this.run(ev.action, async () => {
				await fork.machine.mergeBack(fork, into);
				await openNew(fork.machine, into);
			}));
		}
		const { thread, check } = this.#forkState(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		const source = thread!;
		await this.run(ev.action, async () => {
			const { threadId } = await source.machine.fork(source);
			await openNew(source.machine, threadId);
		});
	}
}

@action({ UUID: `${ID}.fork` })
export class ForkKey extends ForkAction {}

/** Merge Back, which Fork's Does setting replaced: hidden from the actions list, still on decks and in older profiles. */
@action({ UUID: `${ID}.merge` })
export class MergeBackKey extends ForkAction {}
