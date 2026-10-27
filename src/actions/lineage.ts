import { type Action, action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";

import { HOLD_CONFIRM_MS } from "../core/approvals.js";
import { availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { renderInfoKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { RpcError } from "../core/t3/rpc.js";
import { pinnedName } from "../core/target.js";
import { canStopWorkflows } from "../core/workflows.js";
import { canOperate, connectionFace, DeckAction, pressWhileDisconnected } from "./base.js";
import { threadNeeds } from "./needs.js";

const ID = "com.alejandrom2.t3deck";

type TargetedSettings = { machine?: string; target?: string; thread?: string; threadTitle?: string };

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

/**
 * Stops the workflows the target thread runs, as T3 Code's Lineage panel does for Claude's provider-native workflows.
 * Hold to stop: a stopped workflow can't be resumed.
 */
@action({ UUID: `${ID}.workflow.stop` })
export class StopWorkflowKey extends LineageKey {
	#state(action: Action<TargetedSettings>) {
		const { thread, gone, pinned } = this.target(action);
		const missing = thread !== undefined && !canStopWorkflows(driverOf(thread)) ? t("workflow.notClaude") : undefined;
		return { thread, pinned, check: availability("workflow", { thread, gone, canOperate: canOperate(thread), missing }) };
	}

	override needs(action: Action<TargetedSettings>): Need[] {
		const { thread } = this.#state(action);
		return [...this.pinnedNeed(action, thread), { kind: "option", option: t("workflow.option"), ok: thread !== undefined && canStopWorkflows(driverOf(thread)) }];
	}

	protected override async paint(action: Action<TargetedSettings>): Promise<void> {
		if (!action.isKey()) return;
		const offline = connectionFace(this.machineOf(action));
		if (offline) return void (await this.setImage(action, offline));
		const { thread, pinned, check } = this.#state(action);
		const detail = check.available ? (subagentLine(thread) ?? thread?.title) : check.reason;
		await this.setImage(action, renderInfoKey({ glyph: "workflow", title: t("workflow.stop"), detail, available: check.available, pinned }));
	}

	override async onKeyUp(ev: KeyUpEvent<TargetedSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, check } = this.#state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (held < HOLD_CONFIRM_MS) return void (await this.flash(ev.action, false, t("workflow.holdToStop")));
		const target = thread!;
		await this.run(ev.action, async () => {
			const workflows = await target.machine.workflows(target);
			if (workflows.length === 0) throw new RpcError("NoWorkflow", "No workflow is running.", t("workflow.none"));
			for (const workflow of workflows) await target.machine.stopWorkflow(target, workflow.id);
		});
	}
}
