import {
	type Action,
	action,
	type DialAction,
	type DialDownEvent,
	type DialRotateEvent,
	type DialUpEvent,
	type TouchTapEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { approvalAuthority, approvalConfirm, type ApprovalPress, approvePress, authorityLabel, confirmed, DENY_PRESS } from "../core/approvals.js";
import { availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { buildAnswers } from "../core/commands.js";
import { COLORS, elapsed, type GlyphName, STATE_COLOR, STATE_GLYPH, stripCanvas, stripIcon } from "../core/render.js";
import { currentOptionValue, type PendingRequest, withOptionValue } from "../core/t3/machine.js";
import type { InteractionMode, OptionValue, RuntimeMode } from "../core/t3/shell.js";
import { deck } from "../deck.js";
import { canOperate, connectionProblem, DeckAction, openThread, pressWhileDisconnected, selectedThread } from "./base.js";
import { launchable, startThread } from "./keys.js";

const ID = "com.alejandrom2.t3deck";

type Strip = { header: string; glyph: GlyphName; color?: string; value: string; detail?: string };

/** Feedback for the shared `layouts/strip.json` layout. */
function strip(content: Strip): Record<string, string> {
	const color = content.color ?? COLORS.text;
	return {
		canvas: stripCanvas(content.color ?? COLORS.accent),
		header: content.header,
		glyph: stripIcon(content.glyph, color),
		value: content.value,
		detail: content.detail ?? "",
	};
}

function disconnectedStrip(header: string, machine: string | undefined): Record<string, string> | undefined {
	switch (connectionProblem(machine)) {
		case "missing":
			return strip({ header, glyph: "plug", color: COLORS.muted, value: "Machine removed", detail: "Pick another in settings" });
		case "none":
			return strip({ header, glyph: "plug", color: COLORS.muted, value: "T3 Code not found", detail: "Open it, then press" });
		case "pair":
			return strip({ header, glyph: "key", color: COLORS.attention, value: "Pair T3 Deck", detail: "Paste a pair link in settings" });
		case "offline":
			return strip({ header, glyph: "plug", color: COLORS.muted, value: "Connecting…", detail: "Press to retry" });
		default:
			return undefined;
	}
}

function statusLine(thread: DeckThread): string {
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
			return "Done";
		case "failed":
			return "Failed";
		case "stopped":
			return "Stopped";
		default:
			return "Idle";
	}
}

/**
 * Rotate moves T3 Code's selection through the board: the strip follows at once, and the thread is visited once the
 * dial rests. Press or tap opens it in T3 Code. Every "selected thread" action follows.
 */
@action({ UUID: `${ID}.dial.threads` })
export class ThreadDial extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isDial()) return;
		const machine = this.machineOf(action);
		const offline = disconnectedStrip("Threads", machine);
		if (offline) return void (await this.setFeedback(action, offline));
		const thread = deck.board.pendingOn(machine) ?? deck.board.selectedOn(machine);
		const threads = deck.board.threadsOn(machine);
		if (thread === undefined) return void (await this.setFeedback(action, strip({ header: "Threads", glyph: "idle", color: COLORS.muted, value: "No threads" })));
		await this.setFeedback(action, strip({
			header: `${threads.indexOf(thread) + 1}/${threads.length} · ${statusLine(thread)}`,
			glyph: STATE_GLYPH[thread.deck],
			color: STATE_COLOR[thread.deck],
			value: thread.title,
			detail: `${thread.projectTitle} · ${thread.model.model}`,
		}));
	}

	override onDialRotate(ev: DialRotateEvent): void {
		deck.board.step(ev.payload.ticks, this.machineOf(ev.action));
	}

	override async onDialUp(ev: DialUpEvent): Promise<void> {
		await this.#open(ev.action);
	}

	override async onTouchTap(ev: TouchTapEvent): Promise<void> {
		await this.#open(ev.action);
	}

	async #open(dial: DialAction<JsonObject>): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const thread = deck.board.pendingOn(machine) ?? deck.board.selectedOn(machine);
		if (await this.allowed(dial, availability("open", { thread, canOperate: true }))) await this.run(dial, () => openThread(thread!), "Opened");
	}
}

type Knob = {
	id: string;
	label: string;
	values: { value: OptionValue; label: string }[];
	current: OptionValue | undefined;
	apply: (value: OptionValue) => Promise<unknown>;
};

const RUNTIME_MODES: { value: RuntimeMode; label: string }[] = [
	{ value: "approval-required", label: "Supervised" },
	{ value: "auto-accept-edits", label: "Auto-accept edits" },
	{ value: "auto", label: "Auto" },
	{ value: "full-access", label: "Full access" },
];
const INTERACTION_MODES: { value: InteractionMode; label: string }[] = [
	{ value: "default", label: "Build" },
	{ value: "plan", label: "Plan" },
];

/** What the Model dial can change on a thread: its model, every option the provider reports for it, access and mode. */
export function knobsFor(thread: DeckThread): Knob[] {
	const { machine, model: selection } = thread;
	const provider = machine.providers().find((candidate) => candidate.instanceId === selection.instanceId);
	const model = provider?.models.find((candidate) => candidate.id === selection.model);
	const knobs: Knob[] = [];
	if (provider !== undefined && !provider.fixedModel && provider.models.length > 1) {
		knobs.push({
			id: "model",
			label: "Model",
			values: provider.models.map((candidate) => ({ value: candidate.id, label: candidate.label })),
			current: selection.model,
			apply: (value) => {
				const next = provider.models.find((candidate) => candidate.id === value);
				const kept = new Set(next?.options.map((option) => option.id));
				return machine.setModelSelection(thread, { ...selection, model: String(value), options: (selection.options ?? []).filter((option) => kept.has(option.id)) });
			},
		});
	}
	for (const option of model?.options ?? []) {
		if (option.values.length < 2) continue;
		knobs.push({
			id: option.id,
			label: option.label,
			values: option.values,
			current: currentOptionValue(selection, option),
			apply: (value) => machine.setModelSelection(thread, withOptionValue(selection, option.id, value)),
		});
	}
	const modes = provider?.runtimeModes;
	knobs.push({
		id: "runtimeMode",
		label: "Access",
		values: modes === undefined ? RUNTIME_MODES : RUNTIME_MODES.filter((mode) => modes.includes(mode.value)),
		current: thread.runtimeMode,
		apply: (value) => machine.setRuntimeMode(thread, value as RuntimeMode),
	});
	if (provider?.interactionModeToggle !== false) {
		knobs.push({
			id: "interactionMode",
			label: "Mode",
			values: INTERACTION_MODES,
			current: thread.interactionMode,
			apply: (value) => machine.setInteractionMode(thread, value as InteractionMode),
		});
	}
	return knobs.filter((knob) => knob.values.length > 1);
}

const labelOf = (knob: Knob, value: OptionValue | undefined): string =>
	knob.values.find((candidate) => candidate.value === value)?.label ?? (value === undefined ? "Default" : String(value));

/**
 * Changes the selected thread's model, its options as the provider reports them (effort, speed, …),
 * access and Build/Plan mode. Rotate previews a value, press applies it, tap moves to the next setting.
 */
@action({ UUID: `${ID}.dial.model` })
export class ModelDial extends DeckAction {
	#key: string | undefined;
	#knobIndex = 0;
	#preview: OptionValue | undefined;

	#state(action: Action<JsonObject>): { thread: DeckThread; knobs: Knob[]; knob: Knob | undefined } | undefined {
		const thread = selectedThread(this.machineOf(action));
		if (thread === undefined) return undefined;
		if (this.#key !== thread.key) {
			this.#key = thread.key;
			this.#knobIndex = 0;
			this.#preview = undefined;
		}
		const knobs = knobsFor(thread);
		return { thread, knobs, knob: knobs[this.#knobIndex % Math.max(1, knobs.length)] };
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isDial()) return;
		const offline = disconnectedStrip("Model", this.machineOf(action));
		if (offline) return void (await this.setFeedback(action, offline));
		const state = this.#state(action);
		if (state === undefined) return void (await this.setFeedback(action, strip({ header: "Model", glyph: "cube", color: COLORS.muted, value: "No thread" })));
		const { thread, knobs, knob } = state;
		if (knob === undefined) return void (await this.setFeedback(action, strip({ header: "Model", glyph: "cube", value: thread.model.model, detail: "Nothing to adjust" })));
		const pending = this.#preview !== undefined && this.#preview !== knob.current;
		const check = availability("model", { thread, canOperate: canOperate(thread) });
		await this.setFeedback(action, strip({
			header: `${knob.label}${knobs.length > 1 ? ` · ${(this.#knobIndex % knobs.length) + 1}/${knobs.length}` : ""}`,
			glyph: "sliders",
			color: !check.available ? COLORS.muted : pending ? COLORS.attention : COLORS.accent,
			value: labelOf(knob, this.#preview ?? knob.current),
			detail: !check.available ? check.reason : pending ? "Press to apply" : thread.model.model,
		}));
	}

	override onDialRotate(ev: DialRotateEvent): void {
		const knob = this.#state(ev.action)?.knob;
		if (knob === undefined) return;
		const values = knob.values.map((candidate) => candidate.value);
		const from = Math.max(0, values.indexOf(this.#preview ?? knob.current ?? values[0]));
		this.#preview = values[Math.min(values.length - 1, Math.max(0, from + ev.payload.ticks))];
		void this.paint(ev.action);
	}

	override onTouchTap(ev: TouchTapEvent): void {
		const count = this.#state(ev.action)?.knobs.length ?? 0;
		if (count === 0) return;
		this.#knobIndex = (this.#knobIndex + 1) % count;
		this.#preview = undefined;
		void this.paint(ev.action);
	}

	override async onDialUp(ev: DialUpEvent): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const state = this.#state(ev.action);
		const value = this.#preview;
		if (state?.knob === undefined || value === undefined || value === state.knob.current) return;
		if (!(await this.allowed(ev.action, availability("model", { thread: state.thread, canOperate: canOperate(state.thread) })))) return;
		const { knob } = state;
		await this.run(ev.action, async () => {
			await knob.apply(value);
			this.#preview = undefined;
		}, "Applied");
	}
}

type PromptListSettings = { prompts?: string };

/** Rotate through saved prompts. Press sends to the selected thread; hold starts a new thread with it. */
@action({ UUID: `${ID}.dial.prompts` })
export class PromptDial extends DeckAction<PromptListSettings> {
	#index = 0;

	#prompts(settings: PromptListSettings): string[] {
		return (settings.prompts ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
	}

	protected override async paint(action: Action<PromptListSettings>): Promise<void> {
		if (!action.isDial()) return;
		const offline = disconnectedStrip("Prompts", this.machineOf(action));
		if (offline) return void (await this.setFeedback(action, offline));
		const prompts = this.#prompts(this.settingsOf(action));
		if (prompts.length === 0) return void (await this.setFeedback(action, strip({ header: "Prompts", glyph: "spark", color: COLORS.muted, value: "No prompts", detail: "Add them in settings" })));
		this.#index = Math.min(this.#index, prompts.length - 1);
		const thread = selectedThread(this.machineOf(action));
		const check = availability("send", { thread, canOperate: canOperate(thread), hasPrompt: true });
		await this.setFeedback(action, strip({
			header: `Prompt ${this.#index + 1}/${prompts.length}`,
			glyph: "spark",
			color: check.available ? undefined : COLORS.muted,
			value: prompts[this.#index],
			detail: check.available ? `→ ${thread!.title}` : check.reason,
		}));
	}

	override async onDialRotate(ev: DialRotateEvent<PromptListSettings>): Promise<void> {
		const count = this.#prompts(ev.payload.settings).length;
		if (count === 0) return;
		this.#index = (((this.#index + ev.payload.ticks) % count) + count) % count;
		await this.paint(ev.action);
	}

	override onDialDown(ev: DialDownEvent<PromptListSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onDialUp(ev: DialUpEvent<PromptListSettings>): Promise<void> {
		const long = this.wasLongPress(ev.action.id);
		const machine = this.machineOf(ev.action);
		if (await pressWhileDisconnected(machine)) return;
		const prompt = this.#prompts(ev.payload.settings)[this.#index];
		const thread = selectedThread(machine);
		if (long) {
			if (!(await this.allowed(ev.action, availability("new", { canOperate: launchable(thread, machine), hasPrompt: prompt !== undefined })))) return;
			return void (await this.run(ev.action, () => startThread(thread, machine, prompt!), "Started"));
		}
		await this.#send(ev.action, thread, prompt);
	}

	override async onTouchTap(ev: TouchTapEvent<PromptListSettings>): Promise<void> {
		await this.#send(ev.action, selectedThread(this.machineOf(ev.action)), this.#prompts(ev.payload.settings)[this.#index]);
	}

	async #send(dial: DialAction<PromptListSettings>, thread: DeckThread | undefined, prompt: string | undefined): Promise<void> {
		if (!(await this.allowed(dial, availability("send", { thread, canOperate: canOperate(thread), hasPrompt: prompt !== undefined })))) return;
		await this.run(dial, () => thread!.machine.send(thread!, prompt!, "auto"), "Sent");
	}
}

type AnswerSettings = { machine?: string; approvalAuthority?: string; approvalConfirm?: string };

type Answering = { id: string; request: PendingRequest; step: number; picks: number[] };

const PRESS_COLOR = (press: ApprovalPress): string => (press.kind === "open" ? COLORS.attention : press.decision === "decline" ? COLORS.error : COLORS.done);

/**
 * Answers what blocks the selected thread (or the board's first blocked one). Approvals: rotate between the
 * action's approval authority (open in T3 Code, or allow once, for the session or always) and Deny; press, or
 * hold when it asks for a hold, to send it. Questions: rotate through choices, press to confirm each. Tap, or a
 * request the deck can't answer, opens the thread in T3 Code.
 */
@action({ UUID: `${ID}.dial.answer` })
export class AnswerDial extends DeckAction<AnswerSettings> {
	#answering: Answering | undefined;
	#loading: string | undefined;

	#target(machine: string | undefined): DeckThread | undefined {
		const selected = selectedThread(machine);
		const blocked = (thread: DeckThread) => thread.pendingRequest !== undefined && (thread.deck === "question" || thread.deck === "approval");
		return selected !== undefined && blocked(selected) ? selected : deck.board.threadsOn(machine).find(blocked);
	}

	/** The request being answered, if its details for `thread`'s current request are loaded. */
	#current(thread: DeckThread): Answering | undefined {
		const id = `${thread.key}#${thread.pendingRequest?.id}`;
		if (this.#answering?.id === id) return this.#answering;
		this.#load(thread, id);
		return undefined;
	}

	#load(thread: DeckThread, id: string): void {
		if (this.#loading === id) return;
		this.#loading = id;
		const pending = thread.pendingRequest!;
		thread.machine
			.pendingRequest(thread)
			.catch((): PendingRequest => ({ type: "unsupported", threadId: pending.threadId, requestId: pending.id, heading: "Needs you in T3 Code" }))
			.then((request) => {
				if (request !== undefined) this.#answering = { id, request, step: 0, picks: request.type === "question" ? request.questions.map(() => 0) : [0] };
			})
			.finally(() => {
				if (this.#loading === id) this.#loading = undefined;
				deck.repaint();
			});
	}

	/** An approval's two choices: what this action's authority allows, then Deny. */
	#choices(action: Action<AnswerSettings>, request: Extract<PendingRequest, { type: "approval" }>): ApprovalPress[] {
		return [approvePress(approvalAuthority(this.settingsOf(action).approvalAuthority), request.decisions), DENY_PRESS];
	}

	protected override async paint(action: Action<AnswerSettings>): Promise<void> {
		if (!action.isDial()) return;
		const offline = disconnectedStrip("Answer", this.machineOf(action));
		if (offline) return void (await this.setFeedback(action, offline));
		const thread = this.#target(this.machineOf(action));
		if (thread === undefined) {
			this.#answering = undefined;
			const authority = authorityLabel(approvalAuthority(this.settingsOf(action).approvalAuthority));
			return void (await this.setFeedback(action, strip({ header: "Answer", glyph: "check", color: COLORS.muted, value: "Nothing pending", detail: `Approvals: ${authority}` })));
		}
		const answering = this.#current(thread);
		const glyph: GlyphName = thread.deck === "approval" ? "shield" : "question";
		if (answering === undefined) return void (await this.setFeedback(action, strip({ header: thread.deck === "approval" ? "Approval" : "Question", glyph, color: COLORS.attention, value: thread.title, detail: "Loading…" })));
		const { request, step, picks } = answering;
		switch (request.type) {
			case "unsupported":
				return void (await this.setFeedback(action, strip({ header: request.heading, glyph, color: COLORS.attention, value: thread.title, detail: "Press to open in T3 Code" })));
			case "approval": {
				const press = this.#choices(action, request)[picks[0] ?? 0];
				const check = press.kind === "open" ? undefined : availability(press.decision === "decline" ? "deny" : "approve", { thread, canOperate: canOperate(thread) });
				if (check?.available === false) return void (await this.setFeedback(action, strip({ header: request.heading, glyph: "shield", color: COLORS.muted, value: press.label, detail: check.reason })));
				const hold = press.kind === "respond" && approvalConfirm(this.settingsOf(action).approvalConfirm) === "hold";
				return void (await this.setFeedback(action, strip({ header: `${request.heading}${hold ? " · hold" : ""}`, glyph: "shield", color: PRESS_COLOR(press), value: press.label, detail: request.summary })));
			}
			case "question": {
				const question = request.questions[step];
				const option = question?.options[picks[step] ?? 0];
				const check = option === undefined ? undefined : availability("answer", { thread, canOperate: canOperate(thread) });
				return void (await this.setFeedback(action, strip({
					header: `${question?.header || "Question"}${request.questions.length > 1 ? ` · ${step + 1}/${request.questions.length}` : ""}`,
					glyph: "question",
					color: check?.available === false ? COLORS.muted : COLORS.attention,
					value: option?.label ?? "Open in T3 Code",
					detail: check?.available === false ? check.reason : (question?.question ?? ""),
				})));
			}
		}
	}

	override onDialRotate(ev: DialRotateEvent<AnswerSettings>): void {
		const answering = this.#answering;
		if (answering === undefined || answering.request.type === "unsupported") return;
		const count = answering.request.type === "approval" ? 2 : (answering.request.questions[answering.step]?.options.length ?? 0);
		if (count === 0) return;
		answering.picks[answering.step] = Math.min(count - 1, Math.max(0, (answering.picks[answering.step] ?? 0) + ev.payload.ticks));
		void this.paint(ev.action);
	}

	override onDialDown(ev: DialDownEvent<AnswerSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onDialUp(ev: DialUpEvent<AnswerSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		const machine = this.machineOf(ev.action);
		if (await pressWhileDisconnected(machine)) return;
		const thread = this.#target(machine);
		const answering = thread === undefined ? undefined : this.#current(thread);
		if (thread === undefined || answering === undefined) return void (await this.allowed(ev.action, availability("answer", { thread, canOperate: canOperate(thread) })));
		const { request, picks } = answering;
		if (request.type === "unsupported") return void (await this.run(ev.action, () => openThread(thread), "Opened"));
		if (request.type === "approval") {
			const press = this.#choices(ev.action, request)[picks[0] ?? 0];
			if (press.kind === "open") return void (await this.run(ev.action, () => openThread(thread), "Opened"));
			if (!(await this.allowed(ev.action, availability(press.decision === "decline" ? "deny" : "approve", { thread, canOperate: canOperate(thread) })))) return;
			if (!confirmed(press, approvalConfirm(ev.payload.settings.approvalConfirm), held)) return void (await this.flash(ev.action, false, "Hold to answer"));
			return void (await this.run(ev.action, () => thread.machine.respond(request.threadId, request.requestId, press.decision), press.decision === "decline" ? "Denied" : "Allowed"));
		}
		const answerable = request.questions[answering.step]?.options.length ?? 0;
		if (answerable === 0) return void (await this.run(ev.action, () => openThread(thread), "Opened"));
		if (answering.step < request.questions.length - 1) {
			answering.step += 1;
			return void (await this.paint(ev.action));
		}
		if (!(await this.allowed(ev.action, availability("answer", { thread, canOperate: canOperate(thread) })))) return;
		await this.run(ev.action, () => thread.machine.answer(request.threadId, request.requestId, buildAnswers(request.questions, picks, request.messageMode)), "Answered");
	}

	override async onTouchTap(ev: TouchTapEvent<AnswerSettings>): Promise<void> {
		const thread = this.#target(this.machineOf(ev.action));
		if (thread !== undefined) await this.run(ev.action, () => openThread(thread), "Opened");
	}
}
