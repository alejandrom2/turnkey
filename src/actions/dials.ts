import { type Action, action, type DialAction } from "@elgato/streamdeck";

import { approvalAuthority, approvalConfirm, type ApprovalPress, approvePress, authorityLabel, confirmed, DENY_PRESS } from "../core/approvals.js";
import { type ActionKind, availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { buildAnswers } from "../core/commands.js";
import { findModel, speedToggle, switchSelection, withOptionValue } from "../core/models.js";
import { dialControl, type DialControl, effortChange, type PowerChoice, powerIconUrl, powerState, stepChoice } from "../core/power.js";
import { dialPrompts } from "../core/prompts.js";
import { COLORS, elapsed, type GlyphName, STATE_COLOR, STATE_GLYPH, stripIcon, toneOf } from "../core/render.js";
import { matchesDial, type ThreadFilter, threadFilter } from "../core/slots.js";
import type { StripContent } from "../core/strip.js";
import type { PendingRequest } from "../core/t3/machine.js";
import { deck } from "../deck.js";
import { canOperate, LONG_PRESS_MS, openThread, pressWhileDisconnected, selectedThread, sendToThread, ultrathinkArmed } from "./base.js";
import { applyEffort, launchable, requestFor, startThread } from "./keys.js";
import { type DialSettings, disconnectedStrip, markIcon, StripDial } from "./strip.js";

const ID = "com.alejandrom2.t3deck";

function statusLine(thread: DeckThread): string {
	const diff = thread.active ? undefined : thread.machine.turnDiff(thread);
	const lines = diff ? ` · +${diff.additions} −${diff.deletions}` : "";
	switch (thread.deck) {
		case "approval":
			return "Needs approval";
		case "question":
			return "Has a question";
		case "running":
			return `Running ${elapsed(thread.activeSince, Date.now())}`;
		case "queued":
			return "Queued";
		case "done":
			return `Done${lines}`;
		case "failed":
			return `Failed${lines}`;
		case "stopped":
			return `Stopped${lines}`;
		default:
			return `Idle${lines}`;
	}
}

const FILTER_LABEL: Record<ThreadFilter, string> = { all: "Threads", attention: "Needs you", active: "Working", unread: "Unread" };

type ThreadDialSettings = DialSettings & { filter?: string; project?: string; recency?: string };

/**
 * The Activity dial: rotate steps through the threads that pass the filter, project and recency, selecting the
 * one it rests on as T3 Code's own open does. Press or tap opens it.
 */
@action({ UUID: `${ID}.dial.threads` })
export class ThreadDial extends StripDial<ThreadDialSettings> {
	#match(action: Action<ThreadDialSettings>): (thread: DeckThread) => boolean {
		const settings = this.settingsOf(action);
		const now = Date.now();
		return (thread) => matchesDial(thread, settings, now);
	}

	protected face(action: Action<ThreadDialSettings>): StripContent {
		const machine = this.machineOf(action);
		const filter = threadFilter(this.settingsOf(action).filter);
		const label = FILTER_LABEL[filter];
		const offline = disconnectedStrip(label, machine);
		if (offline) return offline;
		const match = this.#match(action);
		const thread = deck.board.shownOn(machine, match);
		if (thread === undefined) return { header: label, icon: stripIcon("check", COLORS.muted), accent: COLORS.muted, value: filter === "all" ? "No threads" : "All quiet" };
		const threads = deck.board.threadsOn(machine).filter(match);
		const model = findModel(thread.machine.modelConfig, thread.model);
		const color = STATE_COLOR[thread.deck];
		return {
			header: `${label} · ${threads.indexOf(thread) + 1}/${threads.length}`,
			icon: model ? markIcon(model) : stripIcon(STATE_GLYPH[thread.deck], color),
			accent: color,
			value: thread.title,
			detail: [statusLine(thread), thread.projectTitle].filter(Boolean).join(" · "),
			detailColor: color === COLORS.muted ? undefined : color,
			tone: toneOf(thread.deck),
			// A running thread's status line ticks every second, which would cut its scroll short.
			scroll: thread.active ? ["value"] : undefined,
		};
	}

	protected override rotated(dial: DialAction<ThreadDialSettings>, ticks: number): void {
		deck.board.step(ticks, this.machineOf(dial), this.#match(dial));
	}

	protected override pressed(dial: DialAction<ThreadDialSettings>): Promise<void> {
		return this.#open(dial);
	}

	protected override tapped(dial: DialAction<ThreadDialSettings>): Promise<void> {
		return this.#open(dial);
	}

	async #open(dial: DialAction<ThreadDialSettings>): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const thread = deck.board.shownOn(machine, this.#match(dial));
		if (await this.allowed(dial, availability("open", { thread, canOperate: true }))) await this.run(dial, () => openThread(thread!), "Opened");
	}
}

type PowerSettings = DialSettings & { dialControls?: string };

const CONTROL: Record<DialControl, { label: string; kind: ActionKind; glyph: GlyphName }> = {
	model: { label: "Model", kind: "model", glyph: "model" },
	effort: { label: "Effort", kind: "effort", glyph: "effort" },
	permissions: { label: "Access", kind: "permissions", glyph: "modeSupervised" },
};

/** The value a Power dial previews; it resets when the selected thread or the dial's setting changes. */
type Preview = { thread: string; control: DialControl; key: string | undefined };

/**
 * The Power dial. It controls one setting of the selected thread, picked in its settings: the model (T3 Code's
 * favorites across providers), the effort (with Ultrathink) or access. Rotate previews, press applies; press with
 * nothing to apply, or a tap, toggles Speed where the model has it.
 */
@action({ UUID: `${ID}.dial.model` })
export class ModelDial extends StripDial<PowerSettings> {
	readonly #previews = new Map<string, Preview>();

	#context(action: Action<PowerSettings>) {
		const control = dialControl(this.settingsOf(action).dialControls);
		const thread = selectedThread(this.machineOf(action));
		if (thread === undefined) return { control, thread };
		const config = thread.machine.modelConfig;
		const armed = ultrathinkArmed(thread);
		const state = powerState(control, config, thread, armed);
		let preview = this.#previews.get(action.id);
		if (preview?.thread !== thread.key || preview.control !== control) {
			preview = { thread: thread.key, control, key: undefined };
			this.#previews.set(action.id, preview);
		}
		const previewed = preview.key === undefined ? undefined : state.choices.find((choice) => choice.key === preview.key);
		const pending = previewed !== undefined && previewed.key !== state.current?.key ? previewed : undefined;
		const check = availability(CONTROL[control].kind, { thread, canOperate: canOperate(thread), missing: state.missing });
		return { control, thread, config, armed, state, preview, pending, check };
	}

	protected face(action: Action<PowerSettings>): StripContent {
		const context = this.#context(action);
		const { label, glyph } = CONTROL[context.control];
		const offline = disconnectedStrip(label, this.machineOf(action));
		if (offline) return offline;
		if (context.thread === undefined) return { header: label, icon: stripIcon(glyph, COLORS.muted), accent: COLORS.muted, value: "No thread" };
		const { thread, state, pending, check, armed } = context;
		const shown = pending ?? state.current;
		const index = shown === undefined ? -1 : state.choices.findIndex((choice) => choice.key === shown.key);
		const color = !check.available ? COLORS.muted : pending ? COLORS.attention : COLORS.accent;
		return {
			header: `${label}${index >= 0 && state.choices.length > 1 ? ` · ${index + 1}/${state.choices.length}` : ""}`,
			icon: shown ? powerIconUrl(shown.icon, { acpIcons: deck.acpIcons }) : stripIcon(glyph),
			accent: color,
			value: shown?.label ?? (context.control === "model" ? thread.model.model : "Default"),
			detail: !check.available ? check.reason : pending ? "Press to apply" : this.#idleDetail(context.control, thread),
			detailColor: pending ? COLORS.attention : undefined,
			tone: toneOf(thread.deck),
			ultrathink: context.control === "effort" && (armed || (pending?.kind === "effort" && pending.ultrathink)),
		};
	}

	#idleDetail(control: DialControl, thread: DeckThread): string {
		const model = findModel(thread.machine.modelConfig, thread.model);
		if (control !== "model") return model?.label ?? thread.model.model;
		const toggle = speedToggle(model, thread.model);
		return toggle ? `Speed: ${toggle.label}` : thread.title;
	}

	protected override rotated(dial: DialAction<PowerSettings>, ticks: number): void {
		const context = this.#context(dial);
		if (context.thread === undefined) return;
		const next = stepChoice(context.state, context.pending?.key, ticks);
		context.preview.key = next?.key === context.state.current?.key ? undefined : next?.key;
	}

	protected override async pressed(dial: DialAction<PowerSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		const context = this.#context(dial);
		if (context.thread === undefined) return void (await this.allowed(dial, availability(CONTROL[context.control].kind, { canOperate: false })));
		if (context.pending === undefined) return this.#toggleSpeed(dial);
		if (!(await this.allowed(dial, context.check))) return;
		const { thread, armed, preview } = context;
		const work = this.#apply(thread, context.pending, armed);
		if (work === undefined) return void (await this.flash(dial, true, context.pending.label));
		await this.run(
			dial,
			async () => {
				await work();
				preview.key = undefined;
			},
			context.pending.kind === "model" ? context.pending.model.name : context.pending.label,
		);
	}

	protected override tapped(dial: DialAction<PowerSettings>): Promise<void> {
		return this.#toggleSpeed(dial);
	}

	#apply(thread: DeckThread, choice: PowerChoice, armed: boolean): (() => Promise<unknown>) | undefined {
		switch (choice.kind) {
			case "model":
				return () => thread.machine.setModelSelection(thread, switchSelection(choice.model, thread.model));
			case "mode":
				return () => thread.machine.setRuntimeMode(thread, choice.mode);
			case "effort": {
				const change = effortChange(findModel(thread.machine.modelConfig, thread.model), thread.model, choice.value);
				return change === undefined ? undefined : applyEffort(thread, change, armed);
			}
		}
	}

	async #toggleSpeed(dial: DialAction<PowerSettings>): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const thread = selectedThread(machine);
		const toggle = thread && speedToggle(findModel(thread.machine.modelConfig, thread.model), thread.model);
		if (!(await this.allowed(dial, availability("speed", { thread, canOperate: canOperate(thread), missing: toggle === undefined ? "No fast mode" : undefined })))) return;
		await this.run(dial, () => thread!.machine.setModelSelection(thread!, withOptionValue(thread!.model, toggle!.option.id, toggle!.next)), toggle!.nextLabel);
	}

	override onWillDisappear(ev: Parameters<StripDial<PowerSettings>["onWillDisappear"]>[0]): void {
		this.#previews.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}

type PromptListSettings = DialSettings & { prompts?: string; templates?: boolean };

/** Rotate through the user's prompts and Quick Prompt's templates. Press or tap sends to the selected thread; hold starts a new thread. */
@action({ UUID: `${ID}.dial.prompts` })
export class PromptDial extends StripDial<PromptListSettings> {
	readonly #index = new Map<string, number>();

	#current(action: Action<PromptListSettings>) {
		const prompts = dialPrompts(this.settingsOf(action));
		const index = Math.min(this.#index.get(action.id) ?? 0, Math.max(0, prompts.length - 1));
		return { prompts, index, prompt: prompts[index] };
	}

	protected face(action: Action<PromptListSettings>): StripContent {
		const offline = disconnectedStrip("Prompts", this.machineOf(action));
		if (offline) return offline;
		const { prompts, index, prompt } = this.#current(action);
		if (prompt === undefined) return { header: "Prompts", icon: stripIcon("spark", COLORS.muted), accent: COLORS.muted, value: "No prompts", detail: "Add them in settings" };
		const thread = selectedThread(this.machineOf(action));
		const check = availability("send", { thread, canOperate: canOperate(thread), hasPrompt: true });
		return {
			header: `${prompt.label ?? "Prompt"} · ${index + 1}/${prompts.length}`,
			icon: stripIcon("spark", check.available ? COLORS.text : COLORS.muted),
			accent: check.available ? COLORS.accent : COLORS.muted,
			value: prompt.text,
			detail: check.available ? `→ ${thread!.title}` : check.reason,
			tone: toneOf(thread?.deck),
			ultrathink: ultrathinkArmed(thread),
		};
	}

	protected override rotated(dial: DialAction<PromptListSettings>, ticks: number): void {
		const { prompts, index } = this.#current(dial);
		if (prompts.length > 0) this.#index.set(dial.id, (((index + ticks) % prompts.length) + prompts.length) % prompts.length);
	}

	protected override async pressed(dial: DialAction<PromptListSettings>, heldMs: number): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const text = this.#current(dial).prompt?.text;
		const thread = selectedThread(machine);
		if (heldMs < LONG_PRESS_MS) return this.#send(dial, thread, text);
		if (!(await this.allowed(dial, availability("new", { canOperate: launchable(thread, machine), hasPrompt: text !== undefined })))) return;
		await this.run(dial, () => startThread(thread, machine, text!), "Started");
	}

	protected override tapped(dial: DialAction<PromptListSettings>): Promise<void> {
		return this.#send(dial, selectedThread(this.machineOf(dial)), this.#current(dial).prompt?.text);
	}

	async #send(dial: DialAction<PromptListSettings>, thread: DeckThread | undefined, text: string | undefined): Promise<void> {
		if (!(await this.allowed(dial, availability("send", { thread, canOperate: canOperate(thread), hasPrompt: text !== undefined })))) return;
		await this.run(dial, () => sendToThread(thread!, text!, "auto"), "Sent");
	}

	override onWillDisappear(ev: Parameters<StripDial<PromptListSettings>["onWillDisappear"]>[0]): void {
		this.#index.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}

type AnswerSettings = DialSettings & { approvalAuthority?: string; approvalConfirm?: string };

/** One dial's progress through a request: its choice per question (or the approval's choice) and the question shown. */
type Answering = { id: string; request: PendingRequest; step: number; picks: number[] };

const PRESS_FACE = (press: ApprovalPress): { glyph: GlyphName; color: string } =>
	press.kind === "open" ? { glyph: "shield", color: COLORS.attention } : press.decision === "decline" ? { glyph: "deny", color: COLORS.error } : { glyph: "approve", color: COLORS.done };

/**
 * Answers what blocks the selected thread (or the board's first blocked one). Approvals: rotate between the dial's
 * approval authority (open in T3 Code, or allow once, for the session or always) and Deny; press, or hold when it
 * asks for a hold, to send it. Questions: rotate through choices, press to confirm each. Tap opens the thread.
 */
@action({ UUID: `${ID}.dial.answer` })
export class AnswerDial extends StripDial<AnswerSettings> {
	readonly #answers = new Map<string, Answering>();

	#target(machine: string | undefined): DeckThread | undefined {
		const selected = selectedThread(machine);
		const blocked = (thread: DeckThread) => thread.pendingRequest !== undefined && (thread.deck === "question" || thread.deck === "approval");
		return selected !== undefined && blocked(selected) ? selected : deck.board.threadsOn(machine).find(blocked);
	}

	/** This dial's progress on `thread`'s request, once its details are loaded. */
	#answering(dial: Action<AnswerSettings>, thread: DeckThread): Answering | undefined {
		const request = requestFor(thread);
		if (request === undefined) return undefined;
		const id = `${thread.key}#${thread.pendingRequest?.id}`;
		const known = this.#answers.get(dial.id);
		if (known?.id === id) return known;
		const answering = { id, request, step: 0, picks: request.type === "question" ? request.questions.map(() => 0) : [0] };
		this.#answers.set(dial.id, answering);
		return answering;
	}

	/** An approval's two choices: what this dial's authority allows, then Deny. */
	#choices(dial: Action<AnswerSettings>, request: Extract<PendingRequest, { type: "approval" }>): ApprovalPress[] {
		return [approvePress(approvalAuthority(this.settingsOf(dial).approvalAuthority), request.decisions), DENY_PRESS];
	}

	protected face(dial: Action<AnswerSettings>): StripContent {
		const offline = disconnectedStrip("Answer", this.machineOf(dial));
		if (offline) return offline;
		const settings = this.settingsOf(dial);
		const thread = this.#target(this.machineOf(dial));
		if (thread === undefined) {
			this.#answers.delete(dial.id);
			return { header: "Answer", icon: stripIcon("check", COLORS.muted), accent: COLORS.muted, value: "Nothing pending", detail: `Approvals: ${authorityLabel(approvalAuthority(settings.approvalAuthority))}` };
		}
		const approval = thread.deck === "approval";
		const answering = this.#answering(dial, thread);
		const waiting: StripContent = { header: approval ? "Approval" : "Question", icon: stripIcon(approval ? "shield" : "question", COLORS.attention), accent: COLORS.attention, value: thread.title, tone: "attention" };
		if (answering === undefined) return { ...waiting, detail: "Loading…" };
		const { request, step, picks } = answering;
		const canAct = canOperate(thread);
		switch (request.type) {
			case "unsupported":
				return { ...waiting, header: request.heading, detail: "Press to open in T3 Code" };
			case "approval": {
				const press = this.#choices(dial, request)[picks[0] ?? 0];
				const check = press.kind === "open" ? undefined : availability(press.decision === "decline" ? "deny" : "approve", { thread, canOperate: canAct });
				const hold = press.kind === "respond" && approvalConfirm(settings.approvalConfirm) === "hold";
				const { glyph, color } = check?.available === false ? { glyph: "shield" as const, color: COLORS.muted } : PRESS_FACE(press);
				return {
					header: request.heading,
					icon: stripIcon(glyph, color),
					accent: color,
					value: request.summary || thread.title,
					detail: check?.available === false ? check.reason : `${press.label}${hold ? " · hold" : ""}`,
					detailColor: color,
					tone: "attention",
				};
			}
			case "question": {
				const question = request.questions[step];
				const option = question?.options[picks[step] ?? 0];
				const check = option === undefined ? undefined : availability("answer", { thread, canOperate: canAct });
				const unavailable = check?.available === false;
				return {
					header: `${question?.header || "Question"}${request.questions.length > 1 ? ` · ${step + 1}/${request.questions.length}` : ""}`,
					icon: stripIcon("question", unavailable ? COLORS.muted : COLORS.attention),
					accent: unavailable ? COLORS.muted : COLORS.attention,
					value: option?.label ?? "Open in T3 Code",
					detail: unavailable ? check.reason : (question?.question ?? ""),
					tone: "attention",
				};
			}
		}
	}

	protected override rotated(dial: DialAction<AnswerSettings>, ticks: number): void {
		const answering = this.#answers.get(dial.id);
		if (answering === undefined || answering.request.type === "unsupported") return;
		const count = answering.request.type === "approval" ? 2 : (answering.request.questions[answering.step]?.options.length ?? 0);
		if (count === 0) return;
		answering.picks[answering.step] = Math.min(count - 1, Math.max(0, (answering.picks[answering.step] ?? 0) + ticks));
	}

	protected override async pressed(dial: DialAction<AnswerSettings>, held: number): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const thread = this.#target(machine);
		const answering = thread === undefined ? undefined : this.#answering(dial, thread);
		if (thread === undefined || answering === undefined) return void (await this.allowed(dial, availability("answer", { thread, canOperate: canOperate(thread) })));
		const { request, picks } = answering;
		if (request.type === "unsupported") return void (await this.run(dial, () => openThread(thread), "Opened"));
		if (request.type === "approval") {
			const press = this.#choices(dial, request)[picks[0] ?? 0];
			if (press.kind === "open") return void (await this.run(dial, () => openThread(thread), "Opened"));
			if (!(await this.allowed(dial, availability(press.decision === "decline" ? "deny" : "approve", { thread, canOperate: canOperate(thread) })))) return;
			if (!confirmed(press, approvalConfirm(this.settingsOf(dial).approvalConfirm), held)) return void (await this.flash(dial, false, "Hold to answer"));
			return void (await this.run(dial, () => thread.machine.respond(request.threadId, request.requestId, press.decision), press.decision === "decline" ? "Denied" : "Allowed"));
		}
		const answerable = request.questions[answering.step]?.options.length ?? 0;
		if (answerable === 0) return void (await this.run(dial, () => openThread(thread), "Opened"));
		if (answering.step < request.questions.length - 1) {
			answering.step += 1;
			return void (await this.paint(dial));
		}
		if (!(await this.allowed(dial, availability("answer", { thread, canOperate: canOperate(thread) })))) return;
		await this.run(dial, () => thread.machine.answer(request.threadId, request.requestId, buildAnswers(request.questions, picks, request.messageMode)), "Answered");
	}

	protected override async tapped(dial: DialAction<AnswerSettings>): Promise<void> {
		const thread = this.#target(this.machineOf(dial));
		if (thread !== undefined) await this.run(dial, () => openThread(thread), "Opened");
	}

	override onWillDisappear(ev: Parameters<StripDial<AnswerSettings>["onWillDisappear"]>[0]): void {
		this.#answers.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}
