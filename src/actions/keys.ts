import streamDeck, { type Action, action, type KeyDownEvent, type KeyUpEvent } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { approvalAuthority, approvalConfirm, approvePress, authorityLabel, confirmed } from "../core/approvals.js";
import { type Availability, availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { openExternal, organize, type OrganizeAction, threadDeepLink } from "../core/commands.js";
import {
	type CatalogModel,
	currentOptionValue,
	cycleValue,
	effortOption,
	effortValues,
	findModel,
	modelCatalog,
	nextModel,
	parseModelKey,
	providerMark,
	RUNTIME_MODES,
	runtimeModes,
	speedToggle,
	switchSelection,
	withOptionValue,
} from "../core/models.js";
import { migratePromptSettings, quickPrompt } from "../core/prompts.js";
import { COLORS, elapsed, type GlyphName, type MarkPainter, renderControlKey, renderInfoKey, renderNoticeKey, renderThreadKey } from "../core/render.js";
import { matchesFilter, type SlotIndex, slotSetting, threadFilter } from "../core/slots.js";
import type { Machine, PendingRequest, SendMode } from "../core/t3/machine.js";
import type { RuntimeMode } from "../core/t3/shell.js";
import { deck } from "../deck.js";
import { canOperate, connectionFace, DeckAction, openThread, pressWhileDisconnected, selectedThread, selectThread } from "./base.js";

const ID = "com.alejandrom2.t3deck";

function threadFace(thread: DeckThread | undefined, emptyLabel: string, selected: DeckThread | undefined): string {
	if (thread === undefined) return renderNoticeKey({ glyph: "chat", title: emptyLabel, tone: "muted" });
	return renderThreadKey({
		state: thread.deck,
		title: thread.title,
		meta: thread.active ? elapsed(thread.activeSince, Date.now()) : undefined,
		diff: thread.active ? undefined : thread.machine.turnDiff(thread),
		unseen: thread.unseen,
		selected: thread.key === selected?.key,
	});
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
		await this.setImage(action, connectionFace(machine) ?? threadFace(this.#threadFor(action), "No thread", selectedThread(machine)));
	}

	override onKeyDown(ev: KeyDownEvent<SlotSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<SlotSettings>): Promise<void> {
		const long = this.wasLongPress(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const thread = this.#threadFor(ev.action);
		if (!(await this.allowed(ev.action, availability("open", { thread, canOperate: true })))) return;
		if (!long) return void (await this.run(ev.action, () => openThread(thread!), "Opened"));
		selectThread(thread!);
		await this.flash(ev.action, true, "Selected");
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
		await this.setImage(action, connectionFace(machine) ?? threadFace(this.#threadFor(action), "All quiet", selectedThread(machine)));
	}

	override async onKeyUp(ev: KeyUpEvent<ActivitySettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const target = this.#threadFor(ev.action);
		if (await this.allowed(ev.action, availability("open", { thread: target, canOperate: true }))) await this.run(ev.action, () => openThread(target!), "Opened");
	}
}

/** Stops the selected thread's turn. */
@action({ UUID: `${ID}.stop` })
export class Stop extends DeckAction {
	#check(action: Action<JsonObject>) {
		const thread = selectedThread(this.machineOf(action));
		return { thread, check: availability("stop", { thread, canOperate: canOperate(thread) }) };
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		await this.setImage(action, renderControlKey({ glyph: "stop", primary: true, available: this.#check(action).check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		await this.run(ev.action, () => thread!.machine.stopRun(thread!), "Stopped");
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
		const thread = selectedThread(this.machineOf(action));
		return { text, label, thread, check: availability(this.steers ? "steer" : "send", { thread, canOperate: canOperate(thread), hasPrompt: text !== "" }) };
	}

	protected override async paint(action: Action<T>): Promise<void> {
		if (!action.isKey()) return;
		const { label, check } = this.#check(action);
		await this.setImage(action, renderControlKey({ glyph: this.glyphName, primary: true, label, available: check.available }));
	}

	override onKeyDown(ev: KeyDownEvent<T>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<T>): Promise<void> {
		const restart = !this.steers && this.wasLongPress(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { text, thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		const mode: SendMode = this.steers ? "steer" : restart ? "restart" : "auto";
		await this.run(ev.action, () => thread!.machine.send(thread!, text, mode), this.steers ? "Steered" : restart ? "Restarted" : "Sent");
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

type NewThreadSettings = { prompt?: string; title?: string; destination?: string; project?: string; machine?: string };

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
			return { near, target: owner, where: { projectId: project ?? "" }, missing: !project ? "Pick a project" : owner === undefined ? "No project" : undefined };
		}
		return { near, target: near?.machine ?? launchMachine(machine), where: near ? { projectId: near.projectId } : { scratch: true } };
	}

	#check(action: Action<NewThreadSettings>): { plan: LaunchPlan; check: Availability } {
		const plan = this.#plan(action);
		return { plan, check: availability("launch", { canOperate: plan.target?.canOperate ?? false, missing: plan.missing }) };
	}

	protected override async paint(action: Action<NewThreadSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { title } = this.settingsOf(action);
		await this.setImage(action, renderControlKey({ glyph: "compose", label: title || undefined, available: this.#check(action).check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent<NewThreadSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { plan, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		const target = plan.target!;
		const prompt = ev.payload.settings.prompt?.trim() ?? "";
		await this.run(
			ev.action,
			async () => {
				const created = await target.launch(plan.where, prompt, { title: ev.payload.settings.title, fallbackModel: plan.near?.model });
				selectThread({ key: `${target.environmentId}/${created.threadId}`, machine: target });
				if (prompt === "" && target.environmentId !== undefined) {
					await openExternal(threadDeepLink({ environmentId: target.environmentId, threadId: created.threadId }, deck.scheme));
				}
			},
			prompt ? "Started" : "Opened",
		);
	}
}

type OrganizeSettings = { organize?: OrganizeAction; snoozeMinutes?: number | string; machine?: string };

const ORGANIZE_FACE: Record<OrganizeAction, [GlyphName, string, string]> = {
	settle: ["settle", "Settle", "Settled"],
	pin: ["pin", "Pin", "Pinned"],
	unpin: ["pin", "Unpin", "Unpinned"],
	snooze: ["moon", "Snooze", "Snoozed"],
	archive: ["archive", "Archive", "Archived"],
	mark_unread: ["chat", "Unread", "Marked unread"],
};

/** Settle, pin, snooze, archive or mark the selected thread unread; the reverse lives in T3 Code or another key. */
@action({ UUID: `${ID}.organize` })
export class Organize extends DeckAction<OrganizeSettings> {
	#check(action: Action<OrganizeSettings>) {
		const which = this.settingsOf(action).organize ?? "settle";
		const thread = selectedThread(this.machineOf(action));
		const kind = which === "pin" || which === "unpin" ? which : "organize";
		return { which, thread, check: availability(kind, { thread, canOperate: canOperate(thread) }) };
	}

	protected override async paint(action: Action<OrganizeSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { which, check } = this.#check(action);
		const [glyph, label] = ORGANIZE_FACE[which];
		await this.setImage(action, renderControlKey({ glyph, label, available: check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent<OrganizeSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { which, thread, check } = this.#check(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		const minutes = Number(ev.payload.settings.snoozeMinutes ?? 60) || 60;
		await this.run(ev.action, () => organize(thread!, which, minutes), ORGANIZE_FACE[which][2]);
	}
}

/** The selected thread on a key's machine, with its machine's model config. */
function selection(machine: string | undefined) {
	const thread = selectedThread(machine);
	return { thread, config: thread?.machine.modelConfig };
}

const markOf =
	(model: CatalogModel): MarkPainter =>
	(x, y, size) =>
		providerMark(model, x, y, size, { acpIcons: deck.acpIcons });

/** A setting key: the current value or the one it applies, highlighted when the thread already has it. */
abstract class SettingKey<T extends JsonObject> extends DeckAction<T> {
	/** The face, the availability and what a press applies (undefined: already current). */
	protected abstract state(action: Action<T>): { face: string; check: Availability; apply?: () => Promise<unknown>; done: string };

	protected override async paint(action: Action<T>): Promise<void> {
		if (!action.isKey()) return;
		await this.setImage(action, connectionFace(this.machineOf(action)) ?? this.state(action).face);
	}

	override async onKeyUp(ev: KeyUpEvent<T>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { check, apply, done } = this.state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (apply === undefined) return void (await this.flash(ev.action, true, done));
		await this.run(ev.action, apply, done);
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
		const { thread, config } = selection(this.machineOf(action));
		const fixed = parseModelKey(this.settingsOf(action).model);
		const current = thread && findModel(config, thread.model);
		const catalog = thread ? modelCatalog(config, thread.model) : [];
		const target = thread === undefined ? undefined : fixed ? findModel(config, fixed) : nextModel(catalog, thread.model);
		const missing = fixed ? (target === undefined ? "Unavailable" : undefined) : catalog.length === 0 ? "No models" : undefined;
		const check = availability("model", { thread, canOperate: canOperate(thread), missing });
		const shown = fixed ? target : current;
		const label = shown?.name ?? (fixed ? fixed.model : (thread?.model.model ?? "Model"));
		const face = renderControlKey({ glyph: "model", mark: shown && markOf(shown), label, available: check.available, active: fixed !== undefined && target?.key === current?.key });
		if (thread === undefined || target === undefined) return { face, check, done: label };
		const already = target.instanceId === thread.model.instanceId && target.slug === thread.model.model;
		return { face, check, done: target.name, apply: already ? undefined : () => thread.machine.setModelSelection(thread, switchSelection(target, thread.model)) };
	}
}

type EffortSettings = { effort?: string; machine?: string };

/** Sets the selected thread's reasoning effort to one value, or steps through the values its model offers. */
@action({ UUID: `${ID}.effort` })
export class EffortKey extends SettingKey<EffortSettings> {
	protected state(action: Action<EffortSettings>) {
		const { thread, config } = selection(this.machineOf(action));
		const fixed = this.settingsOf(action).effort || undefined;
		const option = effortOption(thread && findModel(config, thread.model));
		const current = thread && option ? currentOptionValue(thread.model, option) : undefined;
		const values = option?.values.map((choice) => choice.value) ?? [];
		const missing = option === undefined ? "No effort" : fixed !== undefined && !values.includes(fixed) ? "Not offered" : undefined;
		const check = availability("effort", { thread, canOperate: canOperate(thread), missing });
		const labelOf = (value: unknown) =>
			option?.values.find((choice) => choice.value === value)?.label ??
			effortValues(config).find((choice) => choice.value === value)?.label ??
			(typeof value === "string" ? value.charAt(0).toUpperCase() + value.slice(1) : "Effort");
		const face = renderControlKey({ glyph: "effort", label: labelOf(fixed ?? current), available: check.available, active: fixed !== undefined && fixed === current });
		const next = fixed ?? cycleValue(values, current);
		if (thread === undefined || option === undefined || next === undefined) return { face, check, done: labelOf(next) };
		return { face, check, done: labelOf(next), apply: next === current ? undefined : () => thread.machine.setModelSelection(thread, withOptionValue(thread.model, option.id, next)) };
	}
}

/** Toggles the selected thread's fast mode (Claude's Fast mode, Codex's Fast tier) where its model offers one. */
@action({ UUID: `${ID}.speed` })
export class SpeedKey extends SettingKey<JsonObject> {
	protected state(action: Action<JsonObject>) {
		const { thread, config } = selection(this.machineOf(action));
		const toggle = thread && speedToggle(findModel(config, thread.model), thread.model);
		const check = availability("speed", { thread, canOperate: canOperate(thread), missing: toggle === undefined ? "No fast mode" : undefined });
		const face = renderControlKey({ glyph: "speed", label: toggle?.label ?? "Speed", available: check.available, active: toggle?.fast === true });
		if (thread === undefined || toggle === undefined) return { face, check, done: "" };
		return { face, check, done: toggle.nextLabel, apply: () => thread.machine.setModelSelection(thread, withOptionValue(thread.model, toggle.option.id, toggle.next)) };
	}
}

const MODE_GLYPH: Record<RuntimeMode, GlyphName> = {
	"approval-required": "modeSupervised",
	"auto-accept-edits": "modeAutoAcceptEdits",
	auto: "modeAuto",
	"full-access": "modeFullAccess",
};

type PermissionSettings = { mode?: string; machine?: string };

/** Sets the selected thread's access (Supervised … Full access), or steps through the modes its provider supports. */
@action({ UUID: `${ID}.permissions` })
export class Permissions extends SettingKey<PermissionSettings> {
	protected state(action: Action<PermissionSettings>) {
		const { thread, config } = selection(this.machineOf(action));
		const fixed = RUNTIME_MODES.find((mode) => mode.value === this.settingsOf(action).mode)?.value;
		const values = thread ? runtimeModes(config, thread.model.instanceId).map((mode) => mode.value) : [];
		const current = thread?.runtimeMode;
		const shown = fixed ?? current ?? "approval-required";
		const missing = fixed !== undefined && !values.includes(fixed) ? "Not offered" : undefined;
		const check = availability("permissions", { thread, canOperate: canOperate(thread), missing });
		const labelOf = (value: RuntimeMode | undefined) => RUNTIME_MODES.find((mode) => mode.value === value)?.label ?? "Access";
		const face = renderControlKey({ glyph: MODE_GLYPH[shown], label: thread || fixed ? labelOf(shown) : "Access", available: check.available, active: fixed !== undefined && fixed === current });
		const next = fixed ?? cycleValue(values, current);
		if (thread === undefined || next === undefined) return { face, check, done: labelOf(next) };
		return { face, check, done: labelOf(next), apply: next === current ? undefined : () => thread.machine.setRuntimeMode(thread, next) };
	}
}

/** Switches the selected thread between Build and Plan. */
@action({ UUID: `${ID}.plan` })
export class PlanKey extends SettingKey<JsonObject> {
	protected state(action: Action<JsonObject>) {
		const { thread, config } = selection(this.machineOf(action));
		const toggle = thread === undefined ? undefined : config?.providers?.find((provider) => provider.instanceId === thread.model.instanceId)?.showInteractionModeToggle;
		const check = availability("plan", { thread, canOperate: canOperate(thread), missing: toggle === false ? "No plan mode" : undefined });
		const planning = thread?.interactionMode === "plan";
		const face = renderControlKey({ glyph: planning ? "modePlan" : "modeBuild", label: planning ? "Plan" : "Build", available: check.available, active: planning });
		if (thread === undefined) return { face, check, done: "" };
		return { face, check, done: planning ? "Build" : "Plan", apply: () => thread.machine.setInteractionMode(thread, planning ? "default" : "plan") };
	}
}

/** Approval details per thread and request, loaded once and shared by every Approve and Deny key. */
const requests = new Map<string, PendingRequest | "loading">();

function requestFor(thread: DeckThread): PendingRequest | undefined {
	const pending = thread.pendingRequest;
	if (pending === undefined) return undefined;
	const id = `${thread.key}#${pending.id}`;
	const cached = requests.get(id);
	if (cached !== undefined) return cached === "loading" ? undefined : cached;
	for (const key of requests.keys()) if (key.startsWith(`${thread.key}#`)) requests.delete(key);
	requests.set(id, "loading");
	thread.machine
		.pendingRequest(thread)
		.catch((): PendingRequest => ({ type: "unsupported", threadId: pending.threadId, requestId: pending.id, heading: "Needs you in T3 Code" }))
		.then((request) => {
			if (request === undefined) requests.delete(id);
			else requests.set(id, request);
			deck.repaint();
		});
	return undefined;
}

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
		const thread = selectedThread(this.machineOf(action));
		const check = availability("approve", { thread, canOperate: authority === "open" || canOperate(thread) });
		const request = check.available && thread !== undefined ? requestFor(thread) : undefined;
		const press = request?.type === "approval" ? approvePress(authority, request.decisions) : undefined;
		return { thread, check, request, press, confirm: approvalConfirm(settings.approvalConfirm), authority };
	}

	protected override async paint(action: Action<ApproveSettings>): Promise<void> {
		if (!action.isKey()) return;
		const face = connectionFace(this.machineOf(action));
		if (face) return void (await this.setImage(action, face));
		const { check, request, press, authority } = this.#state(action);
		if (!check.available) return void (await this.setImage(action, renderInfoKey({ glyph: "shield", title: authorityLabel(authority), detail: check.reason, available: false })));
		const title = request === undefined ? "Loading…" : request.type === "approval" ? request.summary : request.type === "unsupported" ? request.heading : "Needs you";
		await this.setImage(action, renderInfoKey({ glyph: "shield", color: COLORS.attention, tint: COLORS.attention, title, detail: press?.label ?? "Open in T3" }));
	}

	override onKeyDown(ev: KeyDownEvent<ApproveSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<ApproveSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, check, request, press, confirm } = this.#state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (request === undefined) return void (await this.flash(ev.action, false, "Loading…"));
		if (press === undefined || press.kind === "open" || request.type !== "approval") return void (await this.run(ev.action, () => openThread(thread!), "Opened"));
		if (!confirmed(press, confirm, held)) return void (await this.flash(ev.action, false, "Hold to allow"));
		await this.run(ev.action, () => thread!.machine.respond(request.threadId, request.requestId, press.decision), press.label);
	}
}

/** Declines the selected thread's approval; a request the deck can't answer opens in T3 Code instead. */
@action({ UUID: `${ID}.deny` })
export class Deny extends DeckAction {
	#state(action: Action<JsonObject>) {
		const thread = selectedThread(this.machineOf(action));
		const check = availability("deny", { thread, canOperate: canOperate(thread) });
		return { thread, check, request: check.available && thread !== undefined ? requestFor(thread) : undefined };
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		await this.setImage(action, renderControlKey({ glyph: "deny", tone: "deny", label: "Deny", available: this.#state(action).check.available }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { thread, check, request } = this.#state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (request === undefined) return void (await this.flash(ev.action, false, "Loading…"));
		if (request.type !== "approval") return void (await this.run(ev.action, () => openThread(thread!), "Opened"));
		await this.run(ev.action, () => thread!.machine.respond(request.threadId, request.requestId, "decline"), "Denied");
	}
}

const machineName = (machine: Machine): string =>
	machine.state.kind === "ready" ? machine.state.label : machine.credential?.label || new URL(machine.url).host;

/** The connection to the action's machine (or all of them): ready, connecting, needs pairing or failing. Tap reconnects. */
@action({ UUID: `${ID}.health` })
export class Health extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const url = this.machineOf(action);
		const machines = deck.machines.filter((machine) => url === undefined || machine.url === url);
		if (machines.length === 0) {
			const title = url === undefined ? "T3 Code not found" : "Machine removed";
			return void (await this.setImage(action, renderInfoKey({ glyph: "plug", title, detail: url === undefined ? "Open it, then press" : "Pick another", available: false })));
		}
		if (machines.length > 1) {
			const ready = machines.filter((machine) => machine.state.kind === "ready").length;
			const color = ready === machines.length ? COLORS.done : ready === 0 ? COLORS.error : COLORS.attention;
			const title = ready === machines.length ? "All connected" : ready === 0 ? "Offline" : "Some offline";
			return void (await this.setImage(action, renderInfoKey({ glyph: "health", color, title, detail: `${ready} of ${machines.length} ready` })));
		}
		const [machine] = machines;
		const name = machineName(machine);
		switch (machine.state.kind) {
			case "ready":
				return void (await this.setImage(action, renderInfoKey({ glyph: "health", color: COLORS.done, title: name, detail: machine.state.canOperate ? "Connected" : "Read only" })));
			case "connecting":
				return void (await this.setImage(action, renderInfoKey({ glyph: "health", color: COLORS.muted, title: name, detail: "Connecting…" })));
			case "signed-out":
				return void (await this.setImage(action, renderInfoKey({ glyph: "key", color: COLORS.attention, tint: COLORS.attention, title: name, detail: "Needs pairing" })));
			case "error":
				return void (await this.setImage(action, renderInfoKey({ glyph: "health", color: COLORS.error, tint: COLORS.error, title: name, detail: machine.state.message })));
		}
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		await deck.retry(this.machineOf(ev.action));
		await this.flash(ev.action, true, "Reconnecting");
	}
}

const PR_STATE: Record<string, [string, string]> = { open: ["Open", COLORS.done], merged: ["Merged", "#A371F7"], closed: ["Closed", COLORS.error] };

/** The selected thread's pull request: number and state. Tap opens it in the browser. */
@action({ UUID: `${ID}.pr` })
export class PullRequest extends DeckAction {
	#state(action: Action<JsonObject>) {
		const thread = selectedThread(this.machineOf(action));
		const pr = thread?.pullRequests.find((link) => link.state === "open") ?? thread?.pullRequests[0];
		return { pr, check: availability("pr", { thread, canOperate: true }) };
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isKey()) return;
		const face = connectionFace(this.machineOf(action));
		if (face) return void (await this.setImage(action, face));
		const { pr, check } = this.#state(action);
		if (pr === undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "pullRequest", title: "Pull request", detail: check.available ? undefined : check.reason, available: false })));
		const [state, color] = PR_STATE[pr.state ?? ""] ?? ["", COLORS.text];
		await this.setImage(action, renderInfoKey({ glyph: "pullRequest", color, title: `#${pr.number}`, detail: state || undefined }));
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { pr, check } = this.#state(ev.action);
		if (!(await this.allowed(ev.action, check))) return;
		if (!URL.canParse(pr!.url) || new URL(pr!.url).protocol !== "https:") return void (await this.flash(ev.action, false, "Not a web link"));
		await this.run(ev.action, () => streamDeck.system.openUrl(pr!.url), "Opened");
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
		const face = check.available
			? renderInfoKey({ glyph: "branch", title: thread!.branch!, detail: thread!.projectTitle || undefined })
			: renderInfoKey({ glyph: "branch", title: "Branch", detail: check.reason, available: false });
		await this.setImage(action, connectionFace(machine) ?? face);
	}

	override async onKeyUp(ev: KeyUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const thread = selectedThread(this.machineOf(ev.action));
		if (await this.allowed(ev.action, availability("branch", { thread, canOperate: true }))) await this.run(ev.action, () => openThread(thread!), "Opened");
	}
}
