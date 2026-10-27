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

import type { DeckThread } from "../core/board.js";
import {
	answer,
	configure,
	currentValue,
	firstQuestion,
	launch,
	type ModelKnob,
	modelKnob,
	type PendingQuestion,
	send,
	withValue,
} from "../core/commands.js";
import { COLORS, elapsed, type GlyphName, STATE_COLOR, STATE_GLYPH, stripCanvas, stripIcon } from "../core/render.js";
import { isActive, type OptionValue } from "../core/t3.js";
import { deck } from "../deck.js";
import { connectionFace, connectionProblem, DeckAction, openThread, preferredThread } from "./base.js";

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
	const problem = connectionProblem(machine);
	if (problem === undefined) return undefined;
	if (problem === "missing") return strip({ header, glyph: "plug", color: COLORS.muted, value: "Machine removed", detail: "Pick another in settings" });
	return problem === "none"
		? strip({ header, glyph: "plug", color: COLORS.muted, value: "T3 Code not found", detail: "Open it, then press" })
		: strip({ header, glyph: "key", color: COLORS.attention, value: "Sign in", detail: "Press to sign in" });
}

const statusLine = (thread: DeckThread): string =>
	isActive(thread.status)
		? `Running ${elapsed(thread.activeSince, Date.now())}`
		: thread.deck === "approval"
			? "Needs approval"
			: thread.deck === "question"
				? "Has a question"
				: thread.deck === "done"
					? "Done"
					: thread.deck === "failed"
						? "Failed"
						: thread.deck === "stopped"
							? "Stopped"
							: thread.deck === "queued"
								? "Queued"
								: "Idle";

/** Rotate moves focus across every thread; press or tap opens it in T3 Code. Everything else follows focus. */
@action({ UUID: `${ID}.dial.threads` })
export class ThreadDial extends DeckAction {
	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isDial()) return;
		const offline = disconnectedStrip("Threads", this.machineOf(action));
		if (offline) return void (await this.setFeedback(action, offline));
		const machine = this.machineOf(action);
		const thread = deck.board.focusedOn(machine);
		const threads = deck.board.threadsOn(machine);
		if (thread === undefined) return void (await this.setFeedback(action, strip({ header: "Threads", glyph: "idle", color: COLORS.muted, value: "No threads", detail: "" })));
		const index = threads.indexOf(thread) + 1;
		await this.setFeedback(action, strip({
			header: `${index}/${threads.length} · ${statusLine(thread)}`,
			glyph: STATE_GLYPH[thread.deck],
			color: STATE_COLOR[thread.deck],
			value: thread.title,
			detail: `${thread.projectTitle} · ${thread.model}`,
		}));
	}

	override onDialRotate(ev: DialRotateEvent): void {
		deck.board.moveFocus(ev.payload.ticks, this.machineOf(ev.action));
	}

	override async onDialUp(ev: DialUpEvent): Promise<void> {
		await this.#open(ev.action);
	}

	override async onTouchTap(ev: TouchTapEvent): Promise<void> {
		await this.#open(ev.action);
	}

	async #open(dial: DialAction<JsonObject>): Promise<void> {
		const machine = this.machineOf(dial);
		if (connectionFace(machine) !== undefined) return void (await deck.signIn(machine));
		const thread = deck.board.focusedOn(machine);
		if (thread !== undefined) await this.run(dial, () => openThread(thread));
	}
}

/**
 * Cycles the focused thread's model options as its provider reports them (effort, speed, …).
 * Rotate previews a value, press applies it to the next run, tap switches which option the dial controls.
 */
@action({ UUID: `${ID}.dial.model` })
export class ModelDial extends DeckAction {
	#knob: { key: string; knob: ModelKnob } | undefined;
	#loading: string | undefined;
	#optionIndex = 0;
	#preview: OptionValue | undefined;

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isDial()) return;
		const offline = disconnectedStrip("Model", this.machineOf(action));
		if (offline) return void (await this.setFeedback(action, offline));
		const thread = preferredThread(this.machineOf(action));
		if (thread === undefined) return void (await this.setFeedback(action, strip({ header: "Model", glyph: "cube", color: COLORS.muted, value: "No thread" })));
		if (this.#knob?.key !== thread.key) {
			this.#load(thread);
			return void (await this.setFeedback(action, strip({ header: "Model", glyph: "cube", value: thread.model, detail: "Loading options…" })));
		}
		const { knob } = this.#knob;
		const option = knob.options[this.#optionIndex % Math.max(1, knob.options.length)];
		if (option === undefined) return void (await this.setFeedback(action, strip({ header: "Model", glyph: "cube", value: thread.model, detail: "No adjustable options" })));
		const current = currentValue(knob, option);
		const shown = this.#preview ?? current;
		await this.setFeedback(action, strip({
			header: `${option.id}${knob.options.length > 1 ? ` · ${this.#optionIndex + 1}/${knob.options.length}` : ""}`,
			glyph: "sliders",
			color: this.#preview !== undefined && this.#preview !== current ? COLORS.attention : COLORS.accent,
			value: String(shown ?? "default"),
			detail: this.#preview !== undefined && this.#preview !== current ? "Press to apply" : thread.model,
		}));
	}

	#load(thread: DeckThread): void {
		if (this.#loading === thread.key) return;
		this.#loading = thread.key;
		modelKnob(thread)
			.then((knob) => {
				this.#knob = { key: thread.key, knob };
				this.#optionIndex = 0;
				this.#preview = undefined;
			})
			.catch(() => (this.#knob = { key: thread.key, knob: { selection: { instanceId: thread.providerInstanceId, model: thread.model }, options: [] } }))
			.finally(() => {
				this.#loading = undefined;
				deck.repaint();
			});
	}

	override onDialRotate(ev: DialRotateEvent): void {
		const option = this.#knob?.knob.options[this.#optionIndex];
		if (option === undefined || this.#knob === undefined) return;
		const values = option.values;
		const from = values.indexOf(this.#preview ?? currentValue(this.#knob.knob, option) ?? values[0]);
		const next = Math.min(values.length - 1, Math.max(0, from + ev.payload.ticks));
		this.#preview = values[next];
		void this.paint(ev.action);
	}

	override onTouchTap(ev: TouchTapEvent): void {
		const count = this.#knob?.knob.options.length ?? 0;
		if (count === 0) return;
		this.#optionIndex = (this.#optionIndex + 1) % count;
		this.#preview = undefined;
		void this.paint(ev.action);
	}

	override async onDialUp(ev: DialUpEvent): Promise<void> {
		const thread = preferredThread(this.machineOf(ev.action));
		const state = this.#knob;
		const option = state?.knob.options[this.#optionIndex];
		if (thread === undefined || state === undefined || option === undefined || this.#preview === undefined) return;
		const selection = withValue(state.knob.selection, option.id, this.#preview);
		await this.run(ev.action, async () => {
			await configure(thread, selection);
			state.knob = { ...state.knob, selection };
			this.#preview = undefined;
		});
	}
}

type PromptListSettings = { prompts?: string };

/** Rotate through saved prompts. Press sends to the focused thread; hold starts a new thread with it. */
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
		await this.setFeedback(action, strip({
			header: `Prompt ${this.#index + 1}/${prompts.length}`,
			glyph: "spark",
			value: prompts[this.#index],
			detail: preferredThread(this.machineOf(action)) ? `→ ${preferredThread(this.machineOf(action))!.title}` : "No thread focused",
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
		const prompt = this.#prompts(ev.payload.settings)[this.#index];
		const thread = preferredThread(this.machineOf(ev.action));
		if (prompt === undefined || thread === undefined) return void (await ev.action.showAlert());
		await this.run(ev.action, async () => {
			if (!long) return send(thread, prompt, "auto");
			const created = await launch(thread, prompt, prompt.slice(0, 60));
			deck.board.focus(`${thread.environmentId}/${created.threadId}`);
		});
	}

	override async onTouchTap(ev: TouchTapEvent<PromptListSettings>): Promise<void> {
		const prompt = this.#prompts(ev.payload.settings)[this.#index];
		const thread = preferredThread(this.machineOf(ev.action));
		if (prompt === undefined || thread === undefined) return;
		await this.run(ev.action, () => send(thread, prompt, "auto"));
	}
}

/**
 * Answers the focused thread's pending question one choice at a time.
 * Approvals cannot be granted over MCP, so for those the dial opens the thread in T3 Code.
 */
@action({ UUID: `${ID}.dial.answer` })
export class AnswerDial extends DeckAction {
	#pending: { key: string; request: PendingQuestion; step: number; picks: number[] } | undefined;
	#loading: string | undefined;

	/** The thread that needs an answer most: the focused one if it is blocked, else the board's first blocked thread. */
	#target(machine: string | undefined): DeckThread | undefined {
		const focused = preferredThread(machine);
		const blocked = (thread: DeckThread) => thread.deck === "question" || thread.deck === "approval";
		return focused !== undefined && blocked(focused) ? focused : deck.board.threadsOn(machine).find(blocked);
	}

	protected override async paint(action: Action<JsonObject>): Promise<void> {
		if (!action.isDial()) return;
		const offline = disconnectedStrip("Answer", this.machineOf(action));
		if (offline) return void (await this.setFeedback(action, offline));
		const thread = this.#target(this.machineOf(action));
		if (thread === undefined) {
			this.#pending = undefined;
			return void (await this.setFeedback(action, strip({ header: "Answer", glyph: "check", color: COLORS.done, value: "Nothing pending" })));
		}
		if (thread.deck === "approval") {
			return void (await this.setFeedback(action, strip({ header: "Approval needed", glyph: "shield", color: COLORS.attention, value: thread.title, detail: "Press to open in T3 Code" })));
		}
		if (this.#pending?.key !== thread.key) {
			this.#load(thread);
			return void (await this.setFeedback(action, strip({ header: "Question", glyph: "question", color: COLORS.attention, value: thread.title, detail: "Loading…" })));
		}
		const { request, step, picks } = this.#pending;
		const question = request.questions[step];
		const option = question?.options[picks[step] ?? 0];
		await this.setFeedback(action, strip({
			header: `${question?.header || "Question"}${request.questions.length > 1 ? ` · ${step + 1}/${request.questions.length}` : ""}`,
			glyph: "question",
			color: COLORS.attention,
			value: option?.label ?? "No options",
			detail: question?.question ?? "",
		}));
	}

	#load(thread: DeckThread): void {
		if (this.#loading === thread.key) return;
		this.#loading = thread.key;
		firstQuestion(thread)
			.then((request) => {
				this.#pending = request === undefined ? undefined : { key: thread.key, request, step: 0, picks: request.questions.map(() => 0) };
			})
			.catch(() => (this.#pending = undefined))
			.finally(() => {
				this.#loading = undefined;
				deck.repaint();
			});
	}

	override onDialRotate(ev: DialRotateEvent): void {
		const pending = this.#pending;
		const question = pending?.request.questions[pending.step];
		if (pending === undefined || question === undefined || question.options.length === 0) return;
		const count = question.options.length;
		pending.picks[pending.step] = Math.min(count - 1, Math.max(0, (pending.picks[pending.step] ?? 0) + ev.payload.ticks));
		void this.paint(ev.action);
	}

	override async onDialUp(ev: DialUpEvent): Promise<void> {
		const thread = this.#target(this.machineOf(ev.action));
		if (thread === undefined) return;
		if (thread.deck === "approval") return void (await this.run(ev.action, () => openThread(thread)));
		const pending = this.#pending;
		if (pending === undefined || pending.key !== thread.key) return;
		if (pending.step < pending.request.questions.length - 1) {
			pending.step += 1;
			return void (await this.paint(ev.action));
		}
		await this.run(ev.action, async () => {
			await answer(thread, pending.request, pending.picks);
			this.#pending = undefined;
		});
	}

	override async onTouchTap(ev: TouchTapEvent): Promise<void> {
		const thread = this.#target(this.machineOf(ev.action));
		if (thread !== undefined) await this.run(ev.action, () => openThread(thread));
	}
}
