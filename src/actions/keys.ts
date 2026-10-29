import { type Action, action, type KeyUpEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { activityKey, type ActivitySettings, newThreadKey, type NewThreadSettings, type NewThreadState, threadKey, type ThreadState } from "../core/keys/threads.js";
import { effortKey, type EffortSettings, modelKey, type ModelSettings, permissionsKey, type PermissionSettings, planKey, type SettingState, speedKey } from "../core/keys/power.js";
import { branchKey, type BranchState } from "../core/keys/lineage.js";
import { asksFirst, organizeKey, type OrganizeSettings, type OrganizeState, snoozeMinutes } from "../core/keys/organize.js";
import { approveKey, type ApproveSettings, type ApproveState, denyKey, type DenyState } from "../core/keys/decision.js";
import { requestFor as coreRequestFor } from "../core/keys/requests.js";
import { availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { type HealthMachine, healthIssues, summarizeHealth } from "../core/health.js";
import { t } from "../core/i18n.js";
import { findModel, modelColor, speedToggle } from "../core/models.js";
import { activityBar, renderActivityBar, renderInfoBar, renderNoticeBar } from "../core/infobar.js";
import { currentEffort, effortChoices } from "../core/power.js";
import { modeOf } from "../core/modes.js";
import { migratePromptSettings, templatePrompt } from "../core/prompts.js";
import { type ConfirmMode, confirmMode } from "../core/review.js";
import { COLORS, type GlyphName, renderControlKey, renderInfoKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { pinnedName } from "../core/target.js";
import { matchesFilter, type SlotIndex, slotSetting, threadFilter } from "../core/slots.js";
import type { Machine, PendingRequest, SendMode } from "../core/t3/machine.js";
import { deck } from "../deck.js";
import { connectionNotice } from "./infobar.js";
import { connectionOf, threadNeeds } from "./needs.js";
import {
	canOperate,
	DeckAction,
	LONG_PRESS_MS,
	machineName,
	machinesOn,
	markArt,
	pressWhileDisconnected,
	queueOf,
	selectNew,
	sendToThread,
	ultrathinkArmed,
} from "./base.js";
import { SharedKey } from "./shared.js";
import { DeckWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";


type SlotSettings = { slot?: number | string; machine?: string };

/** A board slot: by position on the device, by number, or the selected thread. Tap opens it in T3 Code; hold selects it. */
@action({ UUID: `${ID}.slot` })
export class ThreadSlot extends SharedKey<SlotSettings, ThreadState> {
	protected readonly definition = threadKey;

	protected override slotNumber(settings: SlotSettings): number | undefined {
		return slotSetting(settings.slot);
	}

	protected override slotFor(action: Action<SlotSettings>): SlotIndex {
		return this.slotOf(action);
	}
}

/** The threads that match a filter, most urgent first, filling keys by position. Tap opens one. */
@action({ UUID: `${ID}.activity` })
export class Activity extends SharedKey<ActivitySettings, ThreadState> {
	protected readonly definition = activityKey;

	protected override slotGroup(settings: ActivitySettings): string {
		return `${settings.machine ?? ""}|${threadFilter(settings.filter)}|${settings.project ?? ""}`;
	}

	protected override slotFor(action: Action<ActivitySettings>): SlotIndex {
		return this.slotOf(action);
	}

	protected override async draw(action: Action<ActivitySettings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		return super.draw(action);
	}

	/** The info bar shows the most urgent matching thread, whatever Activity keys sit on the same device. */
	async #paintBar(action: Action<ActivitySettings>): Promise<void> {
		const machine = this.machineOf(action);
		const { filter, project } = this.settingsOf(action);
		const notice = connectionNotice(machine);
		const all = deck.board.threadsOn(machine);
		const matching = all.filter((thread) => matchesFilter(thread, threadFilter(filter), project || undefined));
		await this.setBar(action, notice ? renderNoticeBar(notice) : renderActivityBar(activityBar(matching, all, t("face.allQuiet"), Date.now())));
	}
}

type PromptSettings = { title?: string; prompt?: string; machine?: string; target?: string; thread?: string; threadTitle?: string };

/**
 * A key that sends a prompt to the selected thread. Tap starts, steers or queues it as T3 Code decides; hold
 * interrupts and restarts with it. Steer keys only ever steer the running turn.
 */
abstract class PromptKey<T extends PromptSettings & JsonObject> extends DeckAction<T> {
	protected abstract prompt(settings: T): { text: string; label: string | undefined };

	protected glyphName(_settings: T): GlyphName {
		return "send";
	}

	protected readonly steers: boolean = false;

	#check(action: Action<T>) {
		const { text, label } = this.prompt(this.settingsOf(action));
		const { thread, gone, pinned } = this.target(action);
		return { text, label, thread, pinned, check: availability(this.steers ? "steer" : "send", { thread, gone, canOperate: canOperate(thread), hasPrompt: text !== "" }) };
	}

	override needs(action: Action<T>): Need[] {
		const { text, thread, pinned } = this.#check(action);
		return [
			...threadNeeds(this.machineOf(action), thread, true, pinned ? pinnedName(this.settingsOf(action)) : undefined),
			...(this.steers ? [{ kind: "running", ok: thread?.active === true } satisfies Need] : []),
			{ kind: "prompt", ok: text !== "" },
		];
	}

	protected override reviewScope(action: Action<T>): string | undefined {
		const { text, thread } = this.#check(action);
		return thread && JSON.stringify([thread.key, text]);
	}

	protected override async draw(action: Action<T>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		if (!action.isKey()) return;
		const { label, check, thread, pinned } = this.#check(action);
		const glyph = this.glyphName(this.settingsOf(action));
		await this.setImage(action, renderControlKey({ glyph, primary: !this.steers, label, available: check.available, ultrathink: ultrathinkArmed(thread), pinned }));
	}

	/** On the Neo info bar: what waits in the target thread's queue, and whether a stop holds it. */
	async #paintBar(action: Action<T>): Promise<void> {
		const notice = connectionNotice(this.machineOf(action));
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const { thread } = this.target(action);
		if (thread === undefined) return this.setBar(action, renderInfoBar({ icon: { glyph: "queued", color: COLORS.muted }, title: t("strip.queue"), detail: t("reason.noThread"), available: false }));
		const queue = queueOf(thread);
		const count = queue?.items.length ?? 0;
		await this.setBar(
			action,
			renderInfoBar({
				icon: { glyph: "queued", color: count > 0 ? COLORS.text : COLORS.muted },
				title: count > 0 ? t("infobar.queued", { count }) : t("strip.nothingQueued"),
				detail: thread.title,
				...(count > 0 && queue?.held ? { right: { text: t("infobar.held"), color: COLORS.attention } } : {}),
			}),
		);
	}

	override async onKeyUp(ev: KeyUpEvent<T>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { text, thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		// Under Hold, the hold confirms the send itself, so it can't also mean restart.
		const restart = !this.steers && this.confirmModeOf(ev.action) !== "hold" && held >= LONG_PRESS_MS;
		const asked: SendMode = this.steers ? "steer" : restart ? "restart" : "auto";
		const glyph = this.glyphName(this.settingsOf(ev.action));
		const mode = await this.guard(ev.action, {
			scope: JSON.stringify([thread!.key, text]),
			detail: asked,
			held,
			holdHint: t("result.holdToSend"),
			card: () => ({ glyph, verb: t(asked === "steer" ? "review.steer" : asked === "restart" ? "review.restart" : "review.send"), target: thread!.title, body: text, footer: t("review.pressToSend") }),
		});
		if (mode === undefined) return;
		const sent = mode as SendMode;
		await this.run(ev.action, () => sendToThread(thread!, text, sent));
	}
}

type SendSettings = PromptSettings & { template?: string };

/** Sends the key's own prompt, or one of a few everyday ones (continue, fix tests, …), to the selected thread. */
abstract class SendAction extends PromptKey<SendSettings> {
	protected override migrateSettings(settings: SendSettings): SendSettings | undefined {
		return migratePromptSettings(settings);
	}

	protected override glyphName(settings: SendSettings): GlyphName {
		return modeOf("send", this.manifestId, settings) === "custom" ? "send" : "spark";
	}

	protected prompt(settings: SendSettings) {
		const { text, label } = templatePrompt(modeOf("send", this.manifestId, settings), settings.prompt);
		return { text, label: settings.title || label };
	}
}

@action({ UUID: `${ID}.send` })
export class SendPrompt extends SendAction {}

/** Quick Prompt, which Send Prompt's templates replaced: hidden from the actions list, still on decks and in older profiles. */
@action({ UUID: `${ID}.quick` })
export class QuickPrompt extends SendAction {}

/** Adds a saved instruction to the selected thread's running turn. */
@action({ UUID: `${ID}.steer` })
export class Steer extends PromptKey<PromptSettings> {
	protected override glyphName(): GlyphName {
		return "steer";
	}

	protected override readonly steers = true;

	protected prompt(settings: PromptSettings) {
		return { text: settings.prompt?.trim() ?? "", label: settings.title || undefined };
	}
}

/** The machine a new thread starts on when no thread is near: the action's machine, else the first that may act. */
const launchMachine = (machine?: string) => machinesOn(machine).find((candidate) => candidate.canOperate);

/**
 * Starts a thread with `prompt` in `near`'s project, or in the scratch project when the board is empty,
 * and selects it so the deck follows it once the shell lists it.
 */
export async function startThread(near: DeckThread | undefined, machine: string | undefined, prompt: string, title?: string): Promise<void> {
	const target = near?.machine ?? launchMachine(machine);
	if (target === undefined) throw new Error("No machine can start threads.");
	const created = await target.launch(near ? { projectId: near.projectId } : { scratch: true }, prompt, { title, fallbackModel: near?.model });
	selectNew(target, created.threadId);
}

/**
 * Starts a thread where "Create in" says: the selected thread's project (the default, or no project when there
 * is none), no project, or a chosen project on whichever machine has it. Without a prompt it starts empty and
 * opens in T3 Code, where the user types.
 */
@action({ UUID: `${ID}.new` })
export class NewThread extends SharedKey<NewThreadSettings, NewThreadState> {
	protected readonly definition = newThreadKey;
}

/**
 * Settle, pin or unpin, snooze, archive or mark the selected thread unread, or wake the thread snoozed last. Pin
 * toggles and Wake undoes a Snooze; the rest are undone in T3 Code.
 */
@action({ UUID: `${ID}.organize` })
export class Organize extends SharedKey<OrganizeSettings & JsonObject, OrganizeState> {
	protected readonly definition = organizeKey;

	/** Wake reads no target, so it lists its own needs; the others use the shared table. */
	override needs(action: Action<OrganizeSettings & JsonObject>): Need[] {
		const { which, thread } = this.stateOf(action);
		if (which !== "wake") return [];
		const url = this.machineOf(action);
		return [
			{ kind: "paired", connection: connectionOf(url) },
			{ kind: "operate", ok: canOperate(thread, url) },
			{ kind: "snoozed", ok: thread !== undefined },
		];
	}

	/** Settle and Snooze ask first (Review by default): both take the thread off the board. */
	protected override confirmModeOf(action: Action<OrganizeSettings & JsonObject>): ConfirmMode {
		const { confirm, confirmSettle } = this.settingsOf(action);
		return asksFirst(this.stateOf(action).which) ? confirmMode(confirm ?? confirmSettle, "review") : "off";
	}

	protected override reviewScope(action: Action<OrganizeSettings & JsonObject>): string | undefined {
		const { which, thread } = this.stateOf(action);
		return asksFirst(which) && thread ? JSON.stringify([which, thread.key, snoozeMinutes(this.settingsOf(action))]) : undefined;
	}
}

/**
 * Switches the selected thread to one favorite model, or to the next of T3 Code's favorites (else of its
 * provider's models). Another provider's model hands the thread over the way T3 Code's picker does.
 */
@action({ UUID: `${ID}.model` })
export class ModelKey extends SharedKey<ModelSettings & JsonObject, SettingState> {
	protected readonly definition = modelKey;

	protected override async draw(action: Action<ModelSettings & JsonObject>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		return super.draw(action);
	}

	/** On the Neo info bar: the selected thread's model with its mark, its effort and, when on, Fast with a bolt. */
	async #paintBar(action: Action<ModelSettings & JsonObject>): Promise<void> {
		const notice = connectionNotice(this.machineOf(action));
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const { thread } = this.target(action);
		const config = thread?.machine.modelConfig;
		if (thread === undefined) return this.setBar(action, renderInfoBar({ icon: { glyph: "model", color: COLORS.muted }, title: t("face.model"), detail: t("reason.noThread"), available: false }));
		const model = findModel(config, thread.model);
		const effort = effortChoices(model).find((choice) => choice.value === currentEffort(model, thread.model, ultrathinkArmed(thread)))?.label;
		const speed = speedToggle(model, thread.model);
		const fast = speed?.fast === true;
		await this.setBar(
			action,
			renderInfoBar({
				icon: model ? markArt(model) : { glyph: "model", color: COLORS.text },
				title: model?.name ?? thread.model.model,
				detail: [effort, fast ? speed.label : undefined].filter(Boolean).join(" · ") || thread.title,
				...(fast ? { right: { glyph: "bolt" as const, color: (model && modelColor(model)) ?? COLORS.accent } } : {}),
			}),
		);
	}
}

/**
 * Sets the selected thread's reasoning effort to one value, or steps through the values its model offers. Ultrathink
 * arms T3 Code's prompt prefix for the thread's next sends from the deck instead of changing the effort.
 */
@action({ UUID: `${ID}.effort` })
export class EffortKey extends SharedKey<EffortSettings & JsonObject, SettingState> {
	protected readonly definition = effortKey;
}

/** Toggles the selected thread's fast mode (Claude's Fast mode, Codex's Fast tier) where its model offers one. */
@action({ UUID: `${ID}.speed` })
export class SpeedKey extends SharedKey<JsonObject, SettingState> {
	protected readonly definition = speedKey;
}

/** Sets the selected thread's access (Supervised … Full access), or steps through the modes its provider supports. */
@action({ UUID: `${ID}.permissions` })
export class Permissions extends SharedKey<PermissionSettings & JsonObject, SettingState> {
	protected readonly definition = permissionsKey;
}

/** Switches the selected thread between Build and Plan. */
@action({ UUID: `${ID}.plan` })
export class PlanKey extends SharedKey<JsonObject, SettingState> {
	protected readonly definition = planKey;
}

export const requestFor = (thread: DeckThread): PendingRequest | undefined => coreRequestFor(deck, thread);

/**
 * Answers the selected thread's approval as far as the key's authority allows: open it in T3 Code, or allow
 * once, for the session or always, with a hold unless set to tap. A request the deck can't answer opens.
 */
@action({ UUID: `${ID}.approve` })
export class Approve extends SharedKey<ApproveSettings & JsonObject, ApproveState> {
	protected readonly definition = approveKey;
}

/** Declines the selected thread's approval; a request the deck can't answer opens in T3 Code instead. */
@action({ UUID: `${ID}.deny` })
export class Deny extends SharedKey<JsonObject, DenyState> {
	protected readonly definition = denyKey;
}

/** A machine as Health weighs it: its connection, and its providers once connected. */
export const healthMachine = (machine: Machine): HealthMachine => ({
	name: machineName(machine),
	state: machine.state.kind,
	canOperate: machine.canOperate,
	message: machine.state.kind === "error" ? machine.state.message : undefined,
	providers: machine.modelConfig?.providers,
});

const healthWatch = new DeckWatch({ open: (machine) => machine.watchConfig() });

const HEALTH_COLOR = { error: COLORS.error, attention: COLORS.attention, note: COLORS.done, ok: COLORS.done, connecting: COLORS.muted } as const;

/**
 * The connections to the action's machine (or all of them) and their providers: the worst problem first (offline,
 * needs pairing, a provider not found, not authenticated, on an unsupported version or unavailable), how many more, else that all is
 * ready. Tap reconnects.
 */
@action({ UUID: `${ID}.health` })
export class Health extends DeckAction {
	/** Provider statuses stay live only while a Health key shows them. */
	protected override readonly watcher = healthWatch;
	/** Health is the connection's own face. */
	protected override readonly showsConnection = false;

	override needs(action: Action<JsonObject>): Need[] {
		const machines = machinesOn(this.machineOf(action));
		const issues = healthIssues(machines.filter((machine) => machine.state.kind === "ready").map(healthMachine));
		// Notes (an update available, a provider turned off on purpose) never fail the check.
		const problems = issues
			.filter((issue) => issue.level !== "note")
			.map((issue) => t(machines.length > 1 ? "needs.problemOn" : "needs.problem", { subject: issue.subject, machine: issue.machine, text: issue.text }));
		return [{ kind: "paired", connection: connectionOf(this.machineOf(action)) }, { kind: "providers", problems }];
	}

	protected override async draw(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const url = this.machineOf(action);
		const machines = machinesOn(url);
		if (machines.length === 0) {
			const title = url === undefined ? t("notice.notFound") : t("notice.machineRemoved");
			return void (await this.setImage(action, renderInfoKey({ glyph: "plug", title, detail: url === undefined ? t("notice.openThenPress") : t("notice.pickAnother"), available: false })));
		}
		const summary = summarizeHealth(machines.map(healthMachine));
		const color = HEALTH_COLOR[summary.level];
		const loud = summary.level === "error" || summary.level === "attention";
		const pairing = machines.length === 1 && machines[0]!.state.kind === "signed-out";
		await this.setImage(action, renderInfoKey({ glyph: pairing ? "key" : "health", color, tint: loud ? color : undefined, title: summary.title, detail: summary.detail }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		await deck.retry(this.machineOf(ev.action));
	}
}

/** The selected thread's branch. Tap opens the thread in T3 Code. */
@action({ UUID: `${ID}.branch` })
export class Branch extends SharedKey<JsonObject, BranchState> {
	protected readonly definition = branchKey;
}
