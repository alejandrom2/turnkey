import { type Action, action, type KeyUpEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { approveKey, type ApproveSettings, type ApproveState, denyKey, type DenyState } from "../core/keys/decision.js";
import { requestFor as coreRequestFor } from "../core/keys/requests.js";
import { type Availability, availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { openExternal, organize, type OrganizeAction, threadDeepLink } from "../core/commands.js";
import { branchSummary } from "../core/git.js";
import { type HealthMachine, healthIssues, summarizeHealth } from "../core/health.js";
import { elapsed, type MessageKey, t } from "../core/i18n.js";
import {
	cycleValue,
	effortValues,
	findModel,
	modeLabel,
	modelCatalog,
	modelColor,
	nextModel,
	parseModelKey,
	RUNTIME_MODES,
	runtimeModes,
	speedToggle,
	switchSelection,
	withOptionValue,
} from "../core/models.js";
import { activityBar, renderActivityBar, renderInfoBar, renderNoticeBar } from "../core/infobar.js";
import { applyChoice, currentEffort, effortChoices, effortPlace, effortToneOf } from "../core/power.js";
import { threadMotion, twinkleStep } from "../core/motion.js";
import { modeOf } from "../core/modes.js";
import { migratePromptSettings, templatePrompt } from "../core/prompts.js";
import { type ConfirmMode, confirmMode } from "../core/review.js";
import {
	COLORS,
	dotsCue,
	type GlyphName,
	accessTone,
	ladderCue,
	maxEffortStyle,
	modelFill,
	MODE_GLYPH,
	paintedGlyphArt,
	renderControlKey,
	renderInfoKey,
	renderNoticeKey,
	renderThreadKey,
} from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { pinnedName } from "../core/target.js";
import { matchesFilter, type SlotIndex, slotSetting, threadFilter } from "../core/slots.js";
import type { Machine, PendingRequest, SendMode } from "../core/t3/machine.js";
import { latestSnoozed, type RuntimeMode } from "../core/t3/shell.js";
import { deck } from "../deck.js";
import { gitTarget, statuses } from "./git.js";
import { connectionNotice } from "./infobar.js";
import { connectionOf, threadNeeds } from "./needs.js";
import {
	canOperate,
	DeckAction,
	LONG_PRESS_MS,
	machineName,
	machinesOn,
	markArt,
	openThread,
	pressWhileDisconnected,
	queuedCount,
	queueOf,
	selectedThread,
	selectNew,
	selectThread,
	sendToThread,
	speedPaint,
	ultrathinkArmed,
	ultrathinkControl,
} from "./base.js";
import { SharedKey } from "./shared.js";
import { DeckWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";


/** A thread's key face, moving as the Motion setting allows; `moving` asks for animation frames. */
function threadFace(thread: DeckThread | undefined, emptyLabel: string, selected: DeckThread | undefined): { face: string; moving: boolean } {
	if (thread === undefined) return { face: renderNoticeKey({ glyph: "chat", title: emptyLabel, tone: "muted" }), moving: false };
	const now = Date.now();
	const { motion, moving } = threadMotion(deck.animator.mode, thread, deck.transitions, now);
	const face = renderThreadKey({
		state: thread.deck,
		title: thread.title,
		meta: elapsed(thread.active ? thread.activeSince : thread.updatedAt, now),
		worktree: thread.worktreePath !== undefined,
		diff: thread.active ? undefined : thread.machine.turnDiff(thread),
		unseen: thread.unseen,
		selected: selected === undefined ? undefined : thread.key === selected.key,
		motion,
		queued: queuedCount(thread),
		subagents: thread.subagents,
	});
	return { face, moving };
}

const pick = (threads: readonly DeckThread[], slot: SlotIndex, machine?: string): DeckThread | undefined =>
	slot === "selected" ? selectedThread(machine) : threads[slot];

type SlotSettings = { slot?: number | string; machine?: string };

/** A board slot: by position on the device, by number, or the selected thread. Tap opens it in T3 Code; hold selects it. */
@action({ UUID: `${ID}.slot` })
export class ThreadSlot extends DeckAction<SlotSettings> {
	protected override slotNumber(settings: SlotSettings): number | undefined {
		return slotSetting(settings.slot);
	}

	#threadFor(action: Action<SlotSettings>): DeckThread | undefined {
		const machine = this.machineOf(action);
		return pick(deck.board.threadsOn(machine), this.slotOf(action), machine);
	}

	protected override async draw(action: Action<SlotSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { face, moving } = threadFace(this.#threadFor(action), t("face.noThread"), selectedThread(this.machineOf(action)));
		this.animate(action, moving);
		await this.setImage(action, face);
	}

	override async onKeyUp(ev: KeyUpEvent<SlotSettings>): Promise<void> {
		const long = this.wasLongPress(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const thread = this.#threadFor(ev.action);
		if (!(await this.allowed(ev.action, availability("open", { thread, canOperate: true })))) return;
		if (!long) return void (await this.run(ev.action, () => openThread(thread!)));
		selectThread(thread!);
	}
}

type ActivitySettings = { machine?: string; filter?: string; project?: string };

/** The threads that match a filter, most urgent first, filling keys by position. Tap opens one. */
@action({ UUID: `${ID}.activity` })
export class Activity extends DeckAction<ActivitySettings> {
	protected override slotGroup(settings: ActivitySettings): string {
		return `${settings.machine ?? ""}|${threadFilter(settings.filter)}|${settings.project ?? ""}`;
	}

	#threadFor(action: Action<ActivitySettings>): DeckThread | undefined {
		const machine = this.machineOf(action);
		const { filter, project } = this.settingsOf(action);
		const threads = deck.board.threadsOn(machine).filter((thread) => matchesFilter(thread, threadFilter(filter), project || undefined));
		return pick(threads, this.slotOf(action), machine);
	}

	protected override async draw(action: Action<ActivitySettings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		if (!action.isKey()) return;
		const { face, moving } = threadFace(this.#threadFor(action), t("face.allQuiet"), selectedThread(this.machineOf(action)));
		this.animate(action, moving);
		await this.setImage(action, face);
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

	override async onKeyUp(ev: KeyUpEvent<ActivitySettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const target = this.#threadFor(ev.action);
		if (await this.allowed(ev.action, availability("open", { thread: target, canOperate: true }))) await this.run(ev.action, () => openThread(target!));
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

type NewThreadSettings = { prompt?: string; title?: string; destination?: string; project?: string; machine?: string; startIn?: string };

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

type LaunchPlan = { near: DeckThread | undefined; target: Machine | undefined; where: { projectId: string } | { scratch: true }; missing?: string };

/**
 * Starts a thread where "Create in" says: the selected thread's project (the default, or no project when there
 * is none), no project, or a chosen project on whichever machine has it. Without a prompt it starts empty and
 * opens in T3 Code, where the user types.
 */
@action({ UUID: `${ID}.new` })
export class NewThread extends DeckAction<NewThreadSettings> {
	#plan(action: Action<NewThreadSettings>): LaunchPlan {
		const { destination, project } = this.settingsOf(action);
		const machine = this.machineOf(action);
		const near = selectedThread(machine);
		if (destination === "scratch") return { near, target: near?.machine ?? launchMachine(machine), where: { scratch: true } };
		if (destination === "project") {
			const owner = deck.machines.find((candidate) => (machine === undefined || candidate.url === machine) && candidate.projects.some((known) => known.id === project));
			return { near, target: owner, where: { projectId: project ?? "" }, missing: !project ? t("reason.pickProject") : owner === undefined ? t("reason.noProject") : undefined };
		}
		return { near, target: near?.machine ?? launchMachine(machine), where: near ? { projectId: near.projectId } : { scratch: true } };
	}

	#check(action: Action<NewThreadSettings>): { plan: LaunchPlan; worktree: boolean; check: Availability } {
		const plan = this.#plan(action);
		const settings = this.settingsOf(action);
		const worktree = settings.startIn === "worktree";
		// A worktree is made on the first message, as in T3 Code's composer, and needs a project's repository.
		const missing = plan.missing ?? (!worktree ? undefined : "scratch" in plan.where ? t("worktree.noProject") : !settings.prompt?.trim() ? t("worktree.needsPrompt") : undefined);
		return { plan, worktree, check: availability("launch", { canOperate: plan.target?.canOperate ?? false, missing }) };
	}

	protected override async draw(action: Action<NewThreadSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { title } = this.settingsOf(action);
		const { worktree, check } = this.#check(action);
		await this.setImage(action, renderControlKey({ glyph: worktree ? "worktree" : "compose", label: title || (worktree ? t("worktree.newThread") : undefined), available: check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent<NewThreadSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { plan, worktree, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		const target = plan.target!;
		const prompt = ev.payload.settings.prompt?.trim() ?? "";
		await this.run(
			ev.action,
			async () => {
				const workspaceStrategy = worktree && "projectId" in plan.where ? await target.worktreeStrategy(plan.where.projectId) : undefined;
				const created = await target.launch(plan.where, prompt, { title: ev.payload.settings.title, fallbackModel: plan.near?.model, workspaceStrategy });
				selectNew(target, created.threadId);
				if (prompt === "" && target.environmentId !== undefined) {
					await openExternal(threadDeepLink({ environmentId: target.environmentId, threadId: created.threadId }, deck.scheme));
				}
			},
		);
	}
}

type OrganizeSettings = { organize?: OrganizeAction; snoozeMinutes?: number | string; confirm?: string; confirmSettle?: string; machine?: string };

const ORGANIZE_FACE: Record<OrganizeAction, [GlyphName, MessageKey]> = {
	settle: ["settle", "organize.settle"],
	pin: ["pin", "organize.pin"],
	unpin: ["pin", "organize.unpin"],
	snooze: ["moon", "organize.snooze"],
	archive: ["archive", "organize.archive"],
	mark_unread: ["chat", "organize.markUnread"],
	wake: ["moon", "organize.wake"],
};

const asksFirst = (which: OrganizeAction) => which === "settle" || which === "snooze";

const snoozeMinutes = (settings: OrganizeSettings) => Number(settings.snoozeMinutes ?? 60) || 60;

/** How long the key snoozes for, short: "30m", "1h", "1d". */
const snoozeLabel = (settings: OrganizeSettings) => {
	const minutes = snoozeMinutes(settings);
	if (minutes % 1440 === 0) return t("time.days", { days: minutes / 1440 });
	return elapsed(0, minutes * 60_000);
};

/** The thread snoozed last on `url`'s machine (or any), while it still sleeps: what Wake brings back. */
function latestAsleep(url: string | undefined): DeckThread | undefined {
	const asleep: DeckThread[] = [];
	for (const machine of deck.machines) {
		const environmentId = machine.environmentId;
		if (machine.state.kind !== "ready" || environmentId === undefined || (url !== undefined && machine.url !== url)) continue;
		const row = latestSnoozed(machine.everyRow);
		if (row !== undefined) asleep.push({ ...row, key: `${environmentId}/${row.threadId}`, machine, environmentId });
	}
	return latestSnoozed(asleep);
}

/**
 * Settle, pin or unpin, snooze, archive or mark the selected thread unread, or wake the thread snoozed last. Pin
 * toggles and Wake undoes a Snooze; the rest are undone in T3 Code.
 */
@action({ UUID: `${ID}.organize` })
export class Organize extends DeckAction<OrganizeSettings> {
	#check(action: Action<OrganizeSettings>) {
		const setting = this.settingsOf(action).organize ?? "settle";
		if (setting === "wake") {
			const thread = latestAsleep(this.machineOf(action));
			const check: Availability = thread === undefined ? { available: false, reason: t("organize.nothingSnoozed") } : availability("organize", { thread, canOperate: canOperate(thread) });
			return { which: setting, pinned: false, targeted: false, thread, check };
		}
		const { thread, gone, pinned: targeted } = this.target(action);
		const pinning = setting === "pin" || setting === "unpin";
		const pin = thread?.pinned ? "unpin" : "pin";
		const which: OrganizeAction = pinning ? pin : setting;
		const kind = pinning ? pin : "organize";
		return { which, pinned: pinning && thread?.pinned === true, targeted, thread, check: availability(kind, { thread, gone, canOperate: canOperate(thread) }) };
	}

	protected override async draw(action: Action<OrganizeSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { which, pinned, targeted, thread, check } = this.#check(action);
		const [glyph, label] = ORGANIZE_FACE[which];
		if (which === "wake") {
			const detail = check.available ? thread?.title : check.reason;
			return void (await this.setImage(action, renderInfoKey({ glyph, title: t(label), detail, available: check.available })));
		}
		const text = which === "snooze" ? t("organize.snoozeFor", { duration: snoozeLabel(this.settingsOf(action)) }) : t(label);
		await this.setImage(action, renderControlKey({ glyph, label: text, available: check.available, active: pinned, pinned: targeted }));
	}

	/** Wake reads no target, so it lists its own needs; the others use the shared table. */
	override needs(action: Action<OrganizeSettings>): Need[] {
		const { which, thread } = this.#check(action);
		if (which !== "wake") return [];
		const url = this.machineOf(action);
		return [
			{ kind: "paired", connection: connectionOf(url) },
			{ kind: "operate", ok: canOperate(thread, url) },
			{ kind: "snoozed", ok: thread !== undefined },
		];
	}

	/** Settle and Snooze ask first (Review by default): both take the thread off the board. */
	protected override confirmModeOf(action: Action<OrganizeSettings>): ConfirmMode {
		const { confirm, confirmSettle } = this.settingsOf(action);
		return asksFirst(this.#check(action).which) ? confirmMode(confirm ?? confirmSettle, "review") : "off";
	}

	protected override reviewScope(action: Action<OrganizeSettings>): string | undefined {
		const { which, thread } = this.#check(action);
		return asksFirst(which) && thread ? JSON.stringify([which, thread.key, snoozeMinutes(this.settingsOf(action))]) : undefined;
	}

	override async onKeyUp(ev: KeyUpEvent<OrganizeSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { which, thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		const minutes = snoozeMinutes(ev.payload.settings);
		const duration = snoozeLabel(ev.payload.settings);
		const go = await this.guard(ev.action, {
			scope: JSON.stringify([which, thread!.key, minutes]),
			held,
			holdHint: t(which === "snooze" ? "result.holdToSnooze" : "result.holdToSettle"),
			card: () => ({
				glyph: ORGANIZE_FACE[which][0],
				verb: which === "snooze" ? t("review.snooze", { duration }) : t("review.settle"),
				target: thread!.title,
				footer: t("review.pressAgain"),
			}),
		});
		if (go === undefined) return;
		await this.run(ev.action, () => organize(thread!, which, minutes));
	}
}

/** A setting key: the current value or the one it applies, highlighted when the thread already has it. */
abstract class SettingKey<T extends JsonObject> extends DeckAction<T> {
	/** The face, the availability, what a press applies (undefined: already current), and whether the face moves. */
	protected abstract state(action: Action<T>): { face: string; check: Availability; apply?: () => Promise<unknown>; moving?: boolean };

	/** The thread the key acts on, with its machine's model config. */
	protected selection(action: Action<T>) {
		const target = this.target(action);
		return { ...target, config: target.thread?.machine.modelConfig };
	}

	protected override async draw(action: Action<T>): Promise<void> {
		if (!action.isKey()) return;
		const state = this.state(action);
		this.animate(action, state.moving === true);
		await this.setImage(action, state.face);
	}

	override async onKeyUp(ev: KeyUpEvent<T>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { check, apply } = this.state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (apply !== undefined) await this.run(ev.action, apply);
	}
}

type ModelSettings = { model?: string; machine?: string; nameColor?: string };

/**
 * Switches the selected thread to one favorite model, or to the next of T3 Code's favorites (else of its
 * provider's models). Another provider's model hands the thread over the way T3 Code's picker does.
 */
@action({ UUID: `${ID}.model` })
export class ModelKey extends SettingKey<ModelSettings> {
	protected override async draw(action: Action<ModelSettings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		return super.draw(action);
	}

	/** On the Neo info bar: the selected thread's model with its mark, its effort and, when on, Fast with a bolt. */
	async #paintBar(action: Action<ModelSettings>): Promise<void> {
		const notice = connectionNotice(this.machineOf(action));
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const { thread, config } = this.selection(action);
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

	protected state(action: Action<ModelSettings>) {
		const { thread, config, gone, pinned } = this.selection(action);
		const fixed = parseModelKey(this.settingsOf(action).model);
		const current = thread && findModel(config, thread.model);
		const catalog = thread ? modelCatalog(config, thread.model) : [];
		const target = thread === undefined ? undefined : fixed ? findModel(config, fixed) : nextModel(catalog, thread.model);
		const missing = fixed ? (target === undefined ? t("reason.unavailable") : undefined) : catalog.length === 0 ? t("reason.noModels") : undefined;
		const check = availability("model", { thread, gone, canOperate: canOperate(thread), missing });
		const shown = fixed ? target : current;
		const label = shown?.name ?? (fixed ? fixed.model : (thread?.model.model ?? t("face.model")));
		const position = shown === undefined ? -1 : catalog.findIndex((model) => model.key === shown.key);
		// The shown model's pill takes its color, as on the Power dial.
		const cue = catalog.length > 1 && position >= 0 ? dotsCue(catalog.length, position, modelFill(maxEffortStyle(deck.appearance.maxEffort), shown && modelColor(shown))) : undefined;
		// The name takes the model's color unless the key's Name color is White.
		const labelColor = this.settingsOf(action).nameColor === "white" ? undefined : shown && modelColor(shown);
		const face = renderControlKey({ glyph: "model", mark: shown && markArt(shown), label, labelColor, available: check.available, active: fixed !== undefined && target?.key === current?.key, cue, pinned });
		if (thread === undefined || target === undefined) return { face, check };
		const already = target.instanceId === thread.model.instanceId && target.slug === thread.model.model;
		return { face, check, apply: already ? undefined : () => thread.machine.setModelSelection(thread, switchSelection(target, thread.model)) };
	}
}

type EffortSettings = { effort?: string; machine?: string };

/**
 * Sets the selected thread's reasoning effort to one value, or steps through the values its model offers. Ultrathink
 * arms T3 Code's prompt prefix for the thread's next sends from the deck instead of changing the effort.
 */
@action({ UUID: `${ID}.effort` })
export class EffortKey extends SettingKey<EffortSettings> {
	protected state(action: Action<EffortSettings>) {
		const { thread, config, gone, pinned } = this.selection(action);
		const fixed = this.settingsOf(action).effort || undefined;
		const model = thread && findModel(config, thread.model);
		const armed = ultrathinkArmed(thread);
		const choices = effortChoices(model);
		const values = choices.map((choice) => choice.value);
		const current = thread && currentEffort(model, thread.model, armed);
		const missing = choices.length === 0 ? t("reason.noEffort") : fixed !== undefined && !values.includes(fixed) ? t("reason.notOffered") : undefined;
		const check = availability("effort", { thread, gone, canOperate: canOperate(thread), missing });
		const labelOf = (value: unknown) =>
			choices.find((choice) => choice.value === value)?.label ??
			effortValues(config).find((choice) => choice.value === value)?.label ??
			(typeof value === "string" ? value.charAt(0).toUpperCase() + value.slice(1) : t("face.effort"));
		const shown = fixed ?? current;
		const step = choices.findIndex((choice) => choice.value === shown);
		const max = effortToneOf(choices, choices[step]?.key, maxEffortStyle(deck.appearance.maxEffort), model && modelColor(model));
		// The upper half of the ladder glitters, twinkling as Motion allows.
		const place = effortPlace(choices, choices[step]?.key);
		const twinkle = place !== undefined && place >= 0.5 ? twinkleStep(deck.animator.mode, Date.now()) : undefined;
		const cue = choices.length > 1 && step >= 0 ? ladderCue(choices.length, step, choices[step]?.ultrathink === true, max?.fill, place, twinkle) : undefined;
		const face = renderControlKey({
			glyph: "effort",
			glyphColor: max?.text,
			label: labelOf(shown),
			labelColor: max?.text,
			available: check.available,
			active: fixed !== undefined && fixed === current,
			ultrathink: armed,
			cue,
			pinned,
		});
		const next = fixed ?? cycleValue(values, current);
		const choice = choices.find((each) => each.value === next);
		const moving = twinkle !== undefined;
		if (thread === undefined || choice === undefined) return { face, check, moving };
		return { face, check, moving, apply: applyChoice(thread, choice, ultrathinkControl(thread, armed)) };
	}
}

/** Toggles the selected thread's fast mode (Claude's Fast mode, Codex's Fast tier) where its model offers one. */
@action({ UUID: `${ID}.speed` })
export class SpeedKey extends SettingKey<JsonObject> {
	protected state(action: Action<JsonObject>) {
		const { thread, config, gone, pinned } = this.selection(action);
		const model = thread && findModel(config, thread.model);
		const toggle = thread && speedToggle(model, thread.model);
		const check = availability("speed", { thread, gone, canOperate: canOperate(thread), missing: toggle === undefined ? t("reason.noFastMode") : undefined });
		const fast = toggle?.fast === true;
		// Just the bolt: outlined at Standard, filled in the model's color at Fast.
		const face = renderControlKey({ glyph: fast ? "speedFilled" : "speed", mark: fast ? paintedGlyphArt("speedFilled", speedPaint(model)) : undefined, available: check.available, pinned });
		if (thread === undefined || toggle === undefined) return { face, check };
		return {
			face,
			check,
			apply: () => thread.machine.setModelSelection(thread, withOptionValue(thread.model, toggle.option.id, toggle.next)),
		};
	}
}

type PermissionSettings = { mode?: string; machine?: string };

/** Sets the selected thread's access (Supervised … Full access), or steps through the modes its provider supports. */
@action({ UUID: `${ID}.permissions` })
export class Permissions extends SettingKey<PermissionSettings> {
	protected state(action: Action<PermissionSettings>) {
		const { thread, config, gone, pinned } = this.selection(action);
		const fixed = RUNTIME_MODES.find((mode) => mode === this.settingsOf(action).mode);
		const values = thread ? runtimeModes(config, thread.model.instanceId).map((mode) => mode.value) : [];
		const current = thread?.runtimeMode;
		const shown = fixed ?? current ?? "approval-required";
		const missing = fixed !== undefined && !values.includes(fixed) ? t("reason.notOffered") : undefined;
		const check = availability("permissions", { thread, gone, canOperate: canOperate(thread), missing });
		const labelOf = (value: RuntimeMode | undefined) => (value === undefined ? t("face.access") : modeLabel(value));
		const full = shown === "full-access" && (thread !== undefined || fixed !== undefined);
		// A track like Effort's: the modes the provider offers, from asking first to hands-off, filled up to the one shown.
		const step = values.indexOf(shown);
		const tone = step >= 0 ? accessTone(values.length > 1 ? step / (values.length - 1) : 1) : undefined;
		const cue = thread && values.length > 1 && step >= 0 ? ladderCue(values.length, step, false, tone!.fill) : undefined;
		const face = renderControlKey({
			glyph: MODE_GLYPH[shown],
			glyphColor: tone?.text,
			labelColor: tone?.text,
			wash: full && current === "full-access" ? COLORS.attention : undefined,
			label: thread || fixed ? labelOf(shown) : t("face.access"),
			available: check.available,
			active: fixed !== undefined && fixed === current,
			cue,
			pinned,
		});
		const next = fixed ?? cycleValue(values, current);
		if (thread === undefined || next === undefined) return { face, check };
		return { face, check, apply: next === current ? undefined : () => thread.machine.setRuntimeMode(thread, next) };
	}
}

/** Switches the selected thread between Build and Plan. */
@action({ UUID: `${ID}.plan` })
export class PlanKey extends SettingKey<JsonObject> {
	protected state(action: Action<JsonObject>) {
		const { thread, config, gone, pinned } = this.selection(action);
		const toggle = thread === undefined ? undefined : config?.providers?.find((provider) => provider.instanceId === thread.model.instanceId)?.showInteractionModeToggle;
		const check = availability("plan", { thread, gone, canOperate: canOperate(thread), missing: toggle === false ? t("reason.noPlanMode") : undefined });
		const planning = thread?.interactionMode === "plan";
		const face = renderControlKey({ glyph: planning ? "modePlan" : "modeBuild", label: t(planning ? "face.plan" : "face.build"), available: check.available, active: planning, pinned });
		if (thread === undefined) return { face, check };
		return { face, check, apply: () => thread.machine.setInteractionMode(thread, planning ? "default" : "plan") };
	}
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
export class Branch extends DeckAction {
	protected override async draw(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		const thread = selectedThread(machine);
		const check = availability("branch", { thread, canOperate: true });
		// The checkout's status is shared with the git keys: read when it first shows and when the turn moves.
		const target = check.available ? gitTarget(machine) : undefined;
		const status = target && statuses.get(target);
		const face = check.available
			? renderInfoKey({ glyph: thread!.worktreePath ? "worktree" : "branch", title: thread!.branch!, detail: (status && branchSummary(status)) ?? (thread!.projectTitle || undefined) })
			: renderInfoKey({ glyph: "branch", title: t("face.branch"), detail: check.reason, available: false });
		await this.setImage(action, face);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const thread = selectedThread(this.machineOf(ev.action));
		if (await this.allowed(ev.action, availability("branch", { thread, canOperate: true }))) await this.run(ev.action, () => openThread(thread!));
	}
}
