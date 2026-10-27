import streamDeck, { type Action, action, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { approvalAuthority, approvalConfirm, approvePress, authorityLabel, confirmed } from "../core/approvals.js";
import { type Availability, availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { openExternal, organize, type OrganizeAction, threadDeepLink } from "../core/commands.js";
import { branchSummary } from "../core/git.js";
import { type HealthMachine, healthIssues, summarizeHealth } from "../core/health.js";
import { elapsed, type MessageKey, t } from "../core/i18n.js";
import {
	type CatalogModel,
	cycleValue,
	effortValues,
	findModel,
	modeLabel,
	modelCatalog,
	modelColor,
	nextModel,
	parseModelKey,
	providerMark,
	RUNTIME_MODES,
	runtimeModes,
	speedToggle,
	switchSelection,
	withOptionValue,
} from "../core/models.js";
import { currentEffort, effortChange, effortChoices, effortToneOf } from "../core/power.js";
import { threadMotion } from "../core/motion.js";
import { migratePromptSettings, QUICK_PROMPTS, quickPrompt } from "../core/prompts.js";
import { type ConfirmMode, confirmMode } from "../core/review.js";
import {
	COLORS,
	dotsCue,
	type GlyphName,
	ladderCue,
	type MarkPainter,
	maxEffortStyle,
	MODE_GLYPH,
	paintedGlyphArt,
	pillCue,
	renderControlKey,
	renderDecisionKey,
	renderInfoKey,
	renderNoticeKey,
	renderSkeletonKey,
	renderThreadKey,
} from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { matchesFilter, type SlotIndex, slotSetting, threadFilter } from "../core/slots.js";
import type { Machine, PendingRequest, SendMode } from "../core/t3/machine.js";
import { latestSnoozed, type RuntimeMode } from "../core/t3/shell.js";
import { deck } from "../deck.js";
import { gitTarget, statuses } from "./git.js";
import { connectionOf } from "./needs.js";
import { pullRequestKeyFace } from "./pr.js";
import {
	canOperate,
	connectionFace,
	DeckAction,
	LONG_PRESS_MS,
	openThread,
	pressWhileDisconnected,
	queuedCount,
	selectedThread,
	selectThread,
	sendToThread,
	speedPaint,
	ultrathinkArmed,
} from "./base.js";

const ID = "com.alejandrom2.t3deck";

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

	protected override async paint(action: Action<SlotSettings>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		const offline = connectionFace(machine);
		const { face, moving } = offline ? { face: offline, moving: false } : threadFace(this.#threadFor(action), t("face.noThread"), selectedThread(machine));
		this.animate(action, moving);
		await this.setImage(action, face);
	}

	override onKeyDown(ev: KeyDownEvent<SlotSettings>): void {
		this.pressStarted(ev.action.id);
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

	protected override async paint(action: Action<ActivitySettings>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.machineOf(action);
		const offline = connectionFace(machine);
		const { face, moving } = offline ? { face: offline, moving: false } : threadFace(this.#threadFor(action), t("face.allQuiet"), selectedThread(machine));
		this.animate(action, moving);
		await this.setImage(action, face);
	}

	override async onKeyUp(ev: KeyUpEvent<ActivitySettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const target = this.#threadFor(ev.action);
		if (await this.allowed(ev.action, availability("open", { thread: target, canOperate: true }))) await this.run(ev.action, () => openThread(target!));
	}
}

/** How long Stop offers to resume the thread it just stopped. */
export const RESUME_MS = 30_000;

/** Stops the selected thread's turn. For a while after the deck stops one, it offers to resume it by sending "Continue". */
@action({ UUID: `${ID}.stop` })
export class Stop extends DeckAction {
	/** The thread each key stopped; `idle` once the deck has seen its turn end, since the stop lands a moment after it resolves. */
	readonly #resume = new Map<string, { key: string; idle: boolean; timer: ReturnType<typeof setTimeout> }>();

	#check(action: Action<JsonObject>) {
		const { thread, gone, pinned } = this.target(action);
		return { thread, pinned, check: availability("stop", { thread, gone, canOperate: canOperate(thread) }) };
	}

	/** The stopped thread this key may resume: still selected and not running again. */
	#resumable(action: Action<JsonObject>): DeckThread | undefined {
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

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const { check, pinned } = this.#check(action);
		if (this.#resumable(action)) return void (await this.setImage(action, renderControlKey({ glyph: "play", primary: true, pinned })));
		await this.setImage(action, renderControlKey({ glyph: "stop", primary: true, available: check.available, pinned }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const resumable = this.#resumable(ev.action);
		if (resumable !== undefined) {
			this.#endResume(ev.action.id);
			return void (await this.run(ev.action, () => sendToThread(resumable, QUICK_PROMPTS.continue.text, "auto")));
		}
		const { thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		await this.run(
			ev.action,
			async () => {
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
			},
		);
	}

	override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
		this.#endResume(ev.action.id);
		super.onWillDisappear(ev);
	}
}

type PromptSettings = { title?: string; prompt?: string; machine?: string };

/**
 * A key that sends a prompt to the selected thread. Tap starts, steers or queues it as T3 Code decides; hold
 * interrupts and restarts with it. Steer keys only ever steer the running turn.
 */
abstract class PromptKey<T extends PromptSettings & JsonObject> extends DeckAction<T> {
	protected abstract prompt(settings: T): { text: string; label: string | undefined };

	protected get glyphName(): GlyphName {
		return "send";
	}

	protected get steers(): boolean {
		return false;
	}

	#check(action: Action<T>) {
		const { text, label } = this.prompt(this.settingsOf(action));
		const { thread, gone, pinned } = this.target(action);
		return { text, label, thread, pinned, check: availability(this.steers ? "steer" : "send", { thread, gone, canOperate: canOperate(thread), hasPrompt: text !== "" }) };
	}

	protected override reviewScope(action: Action<T>): string | undefined {
		const { text, thread } = this.#check(action);
		return thread && JSON.stringify([thread.key, text]);
	}

	protected override async paint(action: Action<T>): Promise<void> {
		if (!action.isKey()) return;
		const { label, check, thread, pinned } = this.#check(action);
		await this.setImage(action, renderControlKey({ glyph: this.glyphName, primary: !this.steers, label, available: check.available, ultrathink: ultrathinkArmed(thread), pinned }));
	}

	override onKeyDown(ev: KeyDownEvent<T>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<T>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { text, thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		// Under Hold, the hold confirms the send itself, so it can't also mean restart.
		const restart = !this.steers && this.confirmModeOf(ev.action) !== "hold" && held >= LONG_PRESS_MS;
		const asked: SendMode = this.steers ? "steer" : restart ? "restart" : "auto";
		const mode = await this.guard(ev.action, {
			scope: JSON.stringify([thread!.key, text]),
			detail: asked,
			held,
			holdHint: t("result.holdToSend"),
			card: () => ({ glyph: this.glyphName, verb: t(asked === "steer" ? "review.steer" : asked === "restart" ? "review.restart" : "review.send"), target: thread!.title, body: text, footer: t("review.pressToSend") }),
		});
		if (mode === undefined) return;
		const sent = mode as SendMode;
		await this.run(ev.action, () => sendToThread(thread!, text, sent));
	}
}

type SendSettings = PromptSettings & { label?: string };

/** Sends a saved prompt to the selected thread. */
@action({ UUID: `${ID}.send` })
export class SendPrompt extends PromptKey<SendSettings> {
	protected override migrateSettings(settings: SendSettings): SendSettings | undefined {
		return migratePromptSettings(settings);
	}

	protected prompt(settings: SendSettings) {
		return { text: settings.prompt?.trim() ?? "", label: settings.title || settings.label || undefined };
	}
}

/** Adds a saved instruction to the selected thread's running turn. */
@action({ UUID: `${ID}.steer` })
export class Steer extends PromptKey<PromptSettings> {
	protected override get glyphName(): GlyphName {
		return "steer";
	}

	protected override get steers(): boolean {
		return true;
	}

	protected prompt(settings: PromptSettings) {
		return { text: settings.prompt?.trim() ?? "", label: settings.title || undefined };
	}
}

type QuickSettings = PromptSettings & { template?: string };

/** One of a few everyday prompts (continue, fix tests, …) or a custom one, sent to the selected thread. */
@action({ UUID: `${ID}.quick` })
export class QuickPrompt extends PromptKey<QuickSettings> {
	protected override get glyphName(): GlyphName {
		return "spark";
	}

	protected prompt(settings: QuickSettings) {
		const { text, label } = quickPrompt(settings);
		return { text, label: settings.title || label };
	}
}

type NewThreadSettings = { prompt?: string; title?: string; destination?: string; project?: string; machine?: string; startIn?: string };

/** The machine a new thread starts on when no thread is near: the action's machine, else the first that may act. */
const launchMachine = (machine?: string) => deck.machines.find((candidate) => candidate.canOperate && (machine === undefined || candidate.url === machine));

/**
 * Starts a thread with `prompt` in `near`'s project, or in the scratch project when the board is empty,
 * and selects it so the deck follows it once the shell lists it.
 */
export async function startThread(near: DeckThread | undefined, machine: string | undefined, prompt: string, title?: string): Promise<void> {
	const target = near?.machine ?? launchMachine(machine);
	if (target === undefined) throw new Error("No machine can start threads.");
	const created = await target.launch(near ? { projectId: near.projectId } : { scratch: true }, prompt, { title, fallbackModel: near?.model });
	selectThread({ key: `${target.environmentId}/${created.threadId}`, machine: target });
}

export const launchable = (near: DeckThread | undefined, machine: string | undefined): boolean => (near !== undefined ? canOperate(near) : launchMachine(machine) !== undefined);

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

	protected override async paint(action: Action<NewThreadSettings>): Promise<void> {
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
				selectThread({ key: `${target.environmentId}/${created.threadId}`, machine: target });
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

	protected override async paint(action: Action<OrganizeSettings>): Promise<void> {
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
			{ kind: "operate", ok: thread?.machine.canOperate ?? deck.machines.some((machine) => machine.canOperate && (url === undefined || machine.url === url)) },
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

	override onKeyDown(ev: KeyDownEvent<OrganizeSettings>): void {
		this.pressStarted(ev.action.id);
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


const markOf =
	(model: CatalogModel): MarkPainter =>
	(x, y, size) =>
		providerMark(model, x, y, size, { acpIcons: deck.acpIcons });

/** A setting key: the current value or the one it applies, highlighted when the thread already has it. */
abstract class SettingKey<T extends JsonObject> extends DeckAction<T> {
	/** The face, the availability and what a press applies (undefined: already current). */
	protected abstract state(action: Action<T>): { face: string; check: Availability; apply?: () => Promise<unknown> };

	/** The thread the key acts on, with its machine's model config. */
	protected selection(action: Action<T>) {
		const target = this.target(action);
		return { ...target, config: target.thread?.machine.modelConfig };
	}

	protected override async paint(action: Action<T>): Promise<void> {
		if (!action.isKey()) return;
		await this.setImage(action, connectionFace(this.machineOf(action)) ?? this.state(action).face);
	}

	override async onKeyUp(ev: KeyUpEvent<T>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { check, apply } = this.state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (apply !== undefined) await this.run(ev.action, apply);
	}
}

type ModelSettings = { model?: string; machine?: string };

/**
 * Switches the selected thread to one favorite model, or to the next of T3 Code's favorites (else of its
 * provider's models). Another provider's model hands the thread over the way T3 Code's picker does.
 */
@action({ UUID: `${ID}.model` })
export class ModelKey extends SettingKey<ModelSettings> {
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
		const cue = catalog.length > 1 && position >= 0 ? dotsCue(catalog.length, position) : undefined;
		const face = renderControlKey({ glyph: "model", mark: shown && markOf(shown), label, available: check.available, active: fixed !== undefined && target?.key === current?.key, cue, pinned });
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
		const cue = choices.length > 1 && step >= 0 ? ladderCue(choices.length, step, choices[step]?.ultrathink === true, max?.fill) : undefined;
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
		const change = thread && next !== undefined ? effortChange(model, thread.model, next) : undefined;
		if (thread === undefined || change === undefined) return { face, check };
		return { face, check, apply: applyEffort(thread, change, armed) };
	}
}

/** What an effort pick does to `thread`: arm Ultrathink, or disarm it and set the option; undefined when nothing changes. */
export function applyEffort(thread: DeckThread, change: NonNullable<ReturnType<typeof effortChange>>, armed: boolean): (() => Promise<unknown>) | undefined {
	if (change.kind === "arm") return armed ? undefined : async () => deck.ultrathink.arm(thread.key);
	if (!change.send && !armed) return undefined;
	return async () => {
		if (change.send) await thread.machine.setModelSelection(thread, withOptionValue(thread.model, change.optionId, change.value));
		deck.ultrathink.disarm(thread.key);
	};
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
		// The pill is filled when the mode shown is the thread's; outlined when this key would switch to it.
		const cue = thread ? pillCue(fixed === undefined || fixed === current, full ? COLORS.attention : COLORS.accent) : undefined;
		const face = renderControlKey({
			glyph: MODE_GLYPH[shown],
			glyphColor: full ? COLORS.attention : undefined,
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

/** Approval details per thread and request, loaded once and shared by every Approve and Deny key. */
const requests = new Map<string, PendingRequest | "loading">();

export function requestFor(thread: DeckThread): PendingRequest | undefined {
	const pending = thread.pendingRequest;
	if (pending === undefined) return undefined;
	const id = `${thread.key}#${pending.id}`;
	const cached = requests.get(id);
	if (cached !== undefined) return cached === "loading" ? undefined : cached;
	for (const key of requests.keys()) if (key.startsWith(`${thread.key}#`)) requests.delete(key);
	requests.set(id, "loading");
	thread.machine
		.pendingRequest(thread)
		.catch((): PendingRequest => ({ type: "unsupported", threadId: pending.threadId, requestId: pending.id, heading: t("approval.needsYou") }))
		.then((request) => {
			if (request === undefined) requests.delete(id);
			else requests.set(id, request);
			deck.repaint();
		});
	return undefined;
}

/** What a request is about, in a line: the approval's summary, or the heading of one the deck can't answer. */
const requestSummary = (request: PendingRequest): string =>
	request.type === "approval" ? request.summary : request.type === "unsupported" ? request.heading : t("face.needsYou");

type ApproveSettings = { approvalAuthority?: string; approvalConfirm?: string; machine?: string };

/**
 * Answers the selected thread's approval as far as the key's authority allows: open it in T3 Code, or allow
 * once, for the session or always, with a hold unless set to tap. A request the deck can't answer opens.
 */
@action({ UUID: `${ID}.approve` })
export class Approve extends DeckAction<ApproveSettings> {
	#state(action: Action<ApproveSettings>) {
		const settings = this.settingsOf(action);
		const authority = approvalAuthority(settings.approvalAuthority);
		const { thread, gone, pinned } = this.target(action);
		const check = availability("approve", { thread, gone, canOperate: authority === "open" || canOperate(thread) });
		const request = check.available && thread !== undefined ? requestFor(thread) : undefined;
		const press = request?.type === "approval" ? approvePress(authority, request.decisions) : undefined;
		return { thread, pinned, check, request, press, confirm: approvalConfirm(settings.approvalConfirm), authority };
	}

	protected override async paint(action: Action<ApproveSettings>): Promise<void> {
		if (!action.isKey()) return;
		const face = connectionFace(this.machineOf(action));
		if (face) return void (await this.setImage(action, face));
		const { check, request, press, authority, confirm, pinned } = this.#state(action);
		if (!check.available) return void (await this.setImage(action, renderDecisionKey({ kind: "approve", armed: false, caption: authorityLabel(authority), detail: check.reason, pinned })));
		if (request === undefined) return void (await this.setImage(action, renderSkeletonKey()));
		const label = press?.label ?? authorityLabel("open");
		const caption = press?.kind === "respond" && confirm === "hold" ? t("strip.withHold", { label }) : label;
		await this.setImage(action, renderDecisionKey({ kind: "approve", armed: true, caption, detail: requestSummary(request), pinned }));
	}

	override onKeyDown(ev: KeyDownEvent<ApproveSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<ApproveSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, check, request, press, confirm } = this.#state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (request === undefined) return void (await this.flash(ev.action, false, t("result.loading")));
		if (press === undefined || press.kind === "open" || request.type !== "approval") return void (await this.run(ev.action, () => openThread(thread!)));
		if (!confirmed(press, confirm, held)) return void (await this.flash(ev.action, false, t("result.holdToAllow")));
		await this.run(ev.action, () => thread!.machine.respond(request.threadId, request.requestId, press.decision));
	}
}

/** Declines the selected thread's approval; a request the deck can't answer opens in T3 Code instead. */
@action({ UUID: `${ID}.deny` })
export class Deny extends DeckAction {
	#state(action: Action<JsonObject>) {
		const { thread, gone, pinned } = this.target(action);
		const check = availability("deny", { thread, gone, canOperate: canOperate(thread) });
		return { thread, pinned, check, request: check.available && thread !== undefined ? requestFor(thread) : undefined };
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const face = connectionFace(this.machineOf(action));
		if (face) return void (await this.setImage(action, face));
		const { check, request, pinned } = this.#state(action);
		if (check.available && request === undefined) return void (await this.setImage(action, renderSkeletonKey()));
		await this.setImage(action, renderDecisionKey({ kind: "deny", armed: check.available, caption: t("face.deny"), detail: request ? requestSummary(request) : check.available ? undefined : check.reason, pinned }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, check, request } = this.#state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (request === undefined) return void (await this.flash(ev.action, false, t("result.loading")));
		if (request.type !== "approval") return void (await this.run(ev.action, () => openThread(thread!)));
		await this.run(ev.action, () => thread!.machine.respond(request.threadId, request.requestId, "decline"));
	}
}

const machineName = (machine: Machine): string =>
	machine.state.kind === "ready" ? machine.state.label : machine.credential?.label || new URL(machine.url).host;

/** A machine as Health weighs it: its connection, and its providers once connected. */
export const healthMachine = (machine: Machine): HealthMachine => ({
	name: machineName(machine),
	state: machine.state.kind,
	canOperate: machine.canOperate,
	message: machine.state.kind === "error" ? machine.state.message : undefined,
	providers: machine.modelConfig?.providers,
});

const HEALTH_COLOR = { error: COLORS.error, attention: COLORS.attention, note: COLORS.done, ok: COLORS.done, connecting: COLORS.muted } as const;

/**
 * The connections to the action's machine (or all of them) and their providers: the worst problem first (offline,
 * needs pairing, a provider not found, not authenticated, on an unsupported version or unavailable), how many more, else that all is
 * ready. Tap reconnects.
 */
@action({ UUID: `${ID}.health` })
export class Health extends DeckAction {
	/** Provider statuses stay live only while a Health key shows them. */
	readonly #shown = new Map<string, string | undefined>();
	readonly #watches = new Map<string, () => void>();

	constructor() {
		super();
		deck.onRepaint(() => this.#sync());
	}

	#machines(action: Action<JsonObject>): Machine[] {
		const url = this.machineOf(action);
		return deck.machines.filter((machine) => url === undefined || machine.url === url);
	}

	#sync(): void {
		const urls = [...this.#shown.values()];
		const wanted = new Set(deck.machines.filter((machine) => urls.some((url) => url === undefined || url === machine.url)).map((machine) => machine.url));
		for (const [url, release] of this.#watches) {
			if (wanted.has(url)) continue;
			release();
			this.#watches.delete(url);
		}
		for (const machine of deck.machines) if (wanted.has(machine.url) && !this.#watches.has(machine.url)) this.#watches.set(machine.url, machine.watchConfig());
	}

	override needs(action: Action<JsonObject>): Need[] {
		const machines = this.#machines(action);
		const issues = healthIssues(machines.filter((machine) => machine.state.kind === "ready").map(healthMachine));
		// Notes (an update available, a provider turned off on purpose) never fail the check.
		const problems = issues.filter((issue) => issue.level !== "note").map((issue) =>
			machines.length > 1 ? `${issue.subject} (${issue.machine}): ${issue.text}` : `${issue.subject}: ${issue.text}`,
		);
		return [{ kind: "paired", connection: connectionOf(this.machineOf(action)) }, { kind: "providers", problems }];
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const url = this.machineOf(action);
		const machines = this.#machines(action);
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

	override onWillAppear(ev: WillAppearEvent<JsonObject>): void {
		super.onWillAppear(ev);
		this.#shown.set(ev.action.id, this.machineOf(ev.action));
		this.#sync();
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<JsonObject>): void {
		super.onDidReceiveSettings(ev);
		this.#shown.set(ev.action.id, this.machineOf(ev.action));
		this.#sync();
	}

	override onWillDisappear(ev: WillDisappearEvent<JsonObject>): void {
		this.#shown.delete(ev.action.id);
		this.#sync();
		super.onWillDisappear(ev);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		await deck.retry(this.machineOf(ev.action));
	}
}

/** The selected thread's pull request: number and state, with live checks, review and findings. Tap opens it in the browser. */
@action({ UUID: `${ID}.pr` })
export class PullRequest extends DeckAction {
	#state(action: Action<JsonObject>) {
		const thread = selectedThread(this.machineOf(action));
		const pr = thread?.pullRequests.find((link) => link.state === "open") ?? thread?.pullRequests[0];
		return { thread, pr, check: availability("pr", { thread, canOperate: true }) };
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const face = connectionFace(this.machineOf(action));
		if (face) return void (await this.setImage(action, face));
		const { thread, pr, check } = this.#state(action);
		if (pr === undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "pullRequest", title: t("face.pullRequest"), detail: check.available ? undefined : check.reason, available: false })));
		await this.setImage(action, pullRequestKeyFace(thread!, pr));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { pr, check } = this.#state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (!URL.canParse(pr!.url) || new URL(pr!.url).protocol !== "https:") return void (await this.flash(ev.action, false, t("result.notWebLink")));
		await this.run(ev.action, () => streamDeck.system.openUrl(pr!.url));
	}
}

/** The selected thread's branch. Tap opens the thread in T3 Code. */
@action({ UUID: `${ID}.branch` })
export class Branch extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
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
		await this.setImage(action, connectionFace(machine) ?? face);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const thread = selectedThread(this.machineOf(ev.action));
		if (await this.allowed(ev.action, availability("branch", { thread, canOperate: true }))) await this.run(ev.action, () => openThread(thread!));
	}
}
