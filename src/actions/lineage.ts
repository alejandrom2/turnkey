import { type Action, action, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import type { KeyContext, PressInput, PressPlan } from "../core/keys/key.js";
import { driverOf, type ForkState, forkKey, type StopSettings, type StopState, stopKey, type TargetedSettings } from "../core/keys/lineage.js";
import { modeOf } from "../core/modes.js";
import { QUICK_PROMPTS } from "../core/prompts.js";
import { renderControlKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { pinnedName } from "../core/target.js";
import { canStopWorkflows } from "../core/workflows.js";
import { canOperate, sendToThread } from "./base.js";
import { threadNeeds } from "./needs.js";
import { SharedKey } from "./shared.js";

const ID = "com.alejandrom2.turnkey";

/** A key aimed at the selected thread or one pinned thread, with a hold to act: lineage changes can't be undone from the deck. */
abstract class LineageKey<S extends TargetedSettings & JsonObject, St> extends SharedKey<S, St> {
	protected pinnedNeed(action: Action<S>, thread: DeckThread | undefined): Need[] {
		const target = this.target(action);
		return threadNeeds(this.machineOf(action), thread, true, target.pinned ? pinnedName(this.settingsOf(action)) : undefined);
	}
}

/** How long Stop offers to resume the thread it just stopped. */
export const RESUME_MS = 30_000;

/**
 * Stop's shared definition, plus what only the deck does: for a while after the deck stops a turn, it offers to resume
 * it by sending "Continue".
 */
abstract class StopAction extends LineageKey<StopSettings & JsonObject, StopState> {
	protected readonly definition = stopKey;
	/** The thread each key stopped; `idle` once the deck has seen its turn end, since the stop lands a moment after it resolves. */
	readonly #resume = new Map<string, { key: string; idle: boolean; timer: ReturnType<typeof setTimeout> }>();

	#workflows(action: Action<StopSettings & JsonObject>): boolean {
		return modeOf("stop", this.manifestId, this.settingsOf(action)) === "workflow";
	}

	protected override definitionSettings(action: Action<StopSettings & JsonObject>): StopSettings & JsonObject {
		const settings = this.settingsOf(action);
		return { ...settings, mode: modeOf("stop", this.manifestId, settings) };
	}

	/** The stopped thread this key may resume: still its target and not running again. */
	#resumable(action: Action<StopSettings & JsonObject>): DeckThread | undefined {
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

	override needs(action: Action<StopSettings & JsonObject>): Need[] {
		const { thread } = this.stateOf(action);
		if (!this.#workflows(action)) return [...this.pinnedNeed(action, thread), { kind: "running", ok: thread?.active === true }];
		return [...this.pinnedNeed(action, thread), { kind: "option", option: t("workflow.option"), ok: thread !== undefined && canStopWorkflows(driverOf(thread)) }];
	}

	protected override async draw(action: Action<StopSettings & JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		if (this.#workflows(action)) {
			this.#endResume(action.id);
			return super.draw(action);
		}
		const { pinned } = this.stateOf(action);
		if (this.#resumable(action)) return void (await this.setImage(action, renderControlKey({ glyph: "play", primary: true, pinned })));
		await super.draw(action);
	}

	protected override pressPlan(action: Action<StopSettings & JsonObject>, state: StopState, ctx: KeyContext<StopSettings & JsonObject>, input: PressInput): PressPlan {
		if (state.mode === "workflow") return super.pressPlan(action, state, ctx, input);
		const resumable = this.#resumable(action);
		if (resumable !== undefined) {
			this.#endResume(action.id);
			return { kind: "run", work: () => sendToThread(resumable, QUICK_PROMPTS.continue.text, "auto") };
		}
		const plan = super.pressPlan(action, state, ctx, input);
		if (plan.kind !== "run") return plan;
		const thread = state.thread!;
		return {
			kind: "run",
			work: async () => {
				await plan.work();
				this.#endResume(action.id);
				const id = action.id;
				this.#resume.set(id, {
					key: thread.key,
					idle: false,
					timer: setTimeout(() => {
						this.#resume.delete(id);
						void this.paint(action);
					}, RESUME_MS),
				});
			},
		};
	}

	override onWillDisappear(ev: WillDisappearEvent<StopSettings & JsonObject>): void {
		this.#endResume(ev.action.id);
		super.onWillDisappear(ev);
	}
}

@action({ UUID: `${ID}.stop` })
export class Stop extends StopAction {}

/** Stop Workflow, which Stop's Stops setting replaced: hidden from the actions list, still on decks and in older profiles. */
@action({ UUID: `${ID}.workflow.stop` })
export class StopWorkflowKey extends StopAction {}

/** Fork and Merge's shared definition, each UUID in its own mode. */
abstract class ForkAction extends LineageKey<TargetedSettings & JsonObject, ForkState> {
	protected readonly definition = forkKey;

	protected override definitionSettings(action: Action<TargetedSettings & JsonObject>): TargetedSettings & JsonObject {
		const settings = this.settingsOf(action);
		return { ...settings, mode: modeOf("fork", this.manifestId, settings) };
	}

	override needs(action: Action<TargetedSettings & JsonObject>): Need[] {
		const { mode, thread } = this.stateOf(action);
		if (mode === "merge") return [...this.pinnedNeed(action, thread), { kind: "value", value: t("lineage.aFork"), ok: thread?.mergeInto !== undefined }];
		return [...this.pinnedNeed(action, thread), { kind: "value", value: t("lineage.aFinishedTurn"), ok: thread !== undefined && thread.latestRunId !== null }];
	}
}

@action({ UUID: `${ID}.fork` })
export class ForkKey extends ForkAction {}

/** Merge Back, which Fork's Does setting replaced: hidden from the actions list, still on decks and in older profiles. */
@action({ UUID: `${ID}.merge` })
export class MergeBackKey extends ForkAction {}
