import { type Action, action, type DialAction } from "@elgato/streamdeck";

import { approvalAuthority, approvalConfirm, type ApprovalPress, approvePress, authorityLabel, confirmed, DENY_PRESS } from "../core/approvals.js";
import { type ActionKind, availability } from "../core/availability.js";
import type { DeckThread } from "../core/board.js";
import { buildAnswers } from "../core/commands.js";
import { elapsed, type MessageKey, t } from "../core/i18n.js";
import { bareModelName, type CatalogModel, findModel, modelColor, speedToggle, switchSelection, withOptionValue } from "../core/models.js";
import { currentEffort, dialControl, type DialControl, effortChange, effortChoices, effortToneOf, powerArt, type PowerChoice, powerState, stepChoice } from "../core/power.js";
import { dialPrompts } from "../core/prompts.js";
import type { SliderInput } from "../core/slider.js";
import { spinAngle } from "../core/motion.js";
import {
	COLORS,
	glyph,
	glyphArt,
	type GlyphName,
	type MarkPainter,
	modelFill,
	paintedGlyphArt,
	SPECTRUM,
	STATE_COLOR,
	STATE_GLYPH,
	svgText,
	THREAD_GLYPH,
	threadTint,
	toneOf,
} from "../core/render.js";
import { matchesDial, type ThreadFilter, threadFilter } from "../core/slots.js";
import type { StripContent } from "../core/strip.js";
import { type StripItem, type StripList, threadRowsArt } from "../core/styles.js";
import type { PendingRequest } from "../core/t3/machine.js";
import { deck } from "../deck.js";
import { canOperate, colorStyle, LONG_PRESS_MS, openThread, pressWhileDisconnected, queuedCount, selectedThread, sendToThread, speedPaint, ultrathinkArmed } from "./base.js";
import { applyEffort, launchable, requestFor, startThread } from "./keys.js";
import { type DialSettings, disconnectedStrip, markArt, StripDial } from "./strip.js";

const ID = "com.alejandrom2.t3deck";

/** A thread's state in a line, with its queue when messages wait there and the subagents it has out. */
function statusLine(thread: DeckThread): string {
	const queued = queuedCount(thread);
	return [
		stateLine(thread),
		queued > 0 ? t("status.queuedCount", { count: queued }) : undefined,
		thread.subagents > 0 ? t(thread.subagents === 1 ? "status.subagent" : "status.subagents", { count: thread.subagents }) : undefined,
	]
		.filter(Boolean)
		.join(" · ");
}

function stateLine(thread: DeckThread): string {
	const diff = thread.active ? undefined : thread.machine.turnDiff(thread);
	const lines = diff ? ` · +${diff.additions} −${diff.deletions}` : "";
	switch (thread.deck) {
		case "approval":
			return t("status.needsApproval");
		case "question":
			return t("status.hasQuestion");
		case "running":
			return t("status.running", { time: elapsed(thread.activeSince, Date.now()) });
		case "queued":
			return t("status.queued");
		case "done":
			return `${t("status.done")}${lines}`;
		case "failed":
			return `${t("status.failed")}${lines}`;
		case "stopped":
			return `${t("status.stopped")}${lines}`;
		default:
			return `${t("status.idle")}${lines}`;
	}
}

/** The running spinner turned to `angle`, around a provider mark when there is one. */
const spinnerArt =
	(color: string, angle: number, inner?: MarkPainter): MarkPainter =>
	(x, y, size) =>
		inner ? glyph("spinner", x, y, size, color, 1.6, angle) + inner(x + size * 0.24, y + size * 0.24, size * 0.52) : glyph("spinner", x, y, size, color, 2, angle);

const FILTER_LABEL: Record<ThreadFilter, MessageKey> = { all: "filter.all", attention: "filter.attention", active: "filter.active", unread: "filter.unread" };

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
		const label = t(FILTER_LABEL[filter]);
		const offline = disconnectedStrip(label, machine);
		if (offline) return offline;
		const match = this.#match(action);
		const thread = deck.board.shownOn(machine, match);
		if (thread === undefined) return { header: label, icon: glyphArt("check", COLORS.muted), accent: COLORS.muted, value: t(filter === "all" ? "strip.noThreads" : "strip.allQuiet") };
		const threads = deck.board.threadsOn(machine).filter(match);
		const model = findModel(thread.machine.modelConfig, thread.model);
		const color = STATE_COLOR[thread.deck];
		const spin = this.#spin(action, thread);
		const mark = model ? markArt(model) : undefined;
		return {
			header: `${label} · ${threads.indexOf(thread) + 1}/${threads.length}`,
			icon: spin === undefined ? (mark ?? glyphArt(STATE_GLYPH[thread.deck], color)) : spinnerArt(color, spin, mark),
			accent: color,
			value: thread.title,
			detail: [statusLine(thread), thread.projectTitle].filter(Boolean).join(" · "),
			detailColor: color === COLORS.muted ? undefined : color,
			tone: toneOf(thread.deck, thread.unseen),
			moving: spin !== undefined && deck.animator.mode !== "off",
		};
	}

	protected override list(action: Action<ThreadDialSettings>): StripList | undefined {
		const machine = this.machineOf(action);
		const filter = threadFilter(this.settingsOf(action).filter);
		if (disconnectedStrip(t(FILTER_LABEL[filter]), machine)) return undefined;
		const match = this.#match(action);
		const thread = deck.board.shownOn(machine, match);
		if (thread === undefined) return undefined;
		const threads = deck.board.threadsOn(machine).filter(match);
		if (!threads.includes(thread)) return undefined;
		const item = (row: DeckThread): StripItem => {
			const color = STATE_COLOR[row.deck];
			const tint = toneOf(row.deck, row.unseen) === "neutral" ? undefined : color;
			const detail = row === thread ? [statusLine(row), row.projectTitle].filter(Boolean).join(" · ") : undefined;
			const spin = this.#spin(action, row);
			const art = spin === undefined ? glyphArt(STATE_GLYPH[row.deck], color === COLORS.muted ? COLORS.text : color) : spinnerArt(color, spin);
			return { key: row.key, label: row.title, art, tint, detail };
		};
		return { heading: t(FILTER_LABEL[filter]), items: threads.map(item), index: threads.indexOf(thread) };
	}

	/** Classic draws thread rows: the selected title, then the next two with their status. */
	protected override picture(action: Action<ThreadDialSettings>): string | undefined {
		const machine = this.machineOf(action);
		if (disconnectedStrip("", machine)) return undefined;
		const match = this.#match(action);
		const thread = deck.board.shownOn(machine, match);
		const threads = deck.board.threadsOn(machine).filter(match);
		const at = thread === undefined ? -1 : threads.indexOf(thread);
		if (at < 0) return undefined;
		return threadRowsArt(
			threads.slice(at, at + 3).map((row) => {
				const color = threadTint(row.deck, row.unseen) ?? COLORS.text;
				return { title: row.title, art: glyphArt(THREAD_GLYPH[row.deck], color), queued: row === thread ? queuedCount(row) : undefined, subagents: row === thread ? row.subagents : undefined };
			}),
		);
	}

	/** A running thread's spinner angle; the carousel stays still, since a frame there redraws the whole strip. */
	#spin(action: Action<ThreadDialSettings>, thread: DeckThread): number | undefined {
		return thread.deck === "running" && this.styleOf(action) !== "carousel" ? spinAngle(deck.animator.mode, Date.now()) : undefined;
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
		if (await this.allowed(dial, availability("open", { thread, canOperate: true }))) await this.run(dial, () => openThread(thread!));
	}
}

type PowerSettings = DialSettings & { dialControls?: string };


/** The thread's effort as `model` would carry it, colored by its level. */
function modelEffort(model: CatalogModel, thread: DeckThread, armed: boolean): SliderInput["suffix"] {
	const value = currentEffort(findModel(thread.machine.modelConfig, thread.model), thread.model, armed);
	const choices = effortChoices(model);
	const choice = choices.find((candidate) => candidate.key === String(value));
	if (choice === undefined) return undefined;
	if (choice.ultrathink) return { text: choice.label, paint: { gradient: SPECTRUM } };
	return { text: choice.label, paint: effortToneOf(choices, choice.key, colorStyle(), modelColor(model))?.text };
}

/** What a previewed choice reads in: the model's color, or its effort level's; amber for other settings. */
function pendingColor(pending: PowerChoice, thread: DeckThread): string {
	if (pending.kind === "model") return modelColor(pending.model) ?? COLORS.text;
	if (pending.kind !== "effort") return COLORS.attention;
	const model = findModel(thread.machine.modelConfig, thread.model);
	return effortToneOf(effortChoices(model), pending.key, colorStyle(), model && modelColor(model))?.text ?? COLORS.attention;
}

const CONTROL: Record<DialControl, { label: MessageKey; kind: ActionKind; glyph: GlyphName }> = {
	model: { label: "face.model", kind: "model", glyph: "model" },
	effort: { label: "face.effort", kind: "effort", glyph: "effort" },
	permissions: { label: "face.access", kind: "permissions", glyph: "modeSupervised" },
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
		const label = t(CONTROL[context.control].label);
		const { glyph } = CONTROL[context.control];
		const offline = disconnectedStrip(label, this.machineOf(action));
		if (offline) return offline;
		if (context.thread === undefined) return { header: label, icon: glyphArt(glyph, COLORS.muted), accent: COLORS.muted, value: t("strip.noThread") };
		const { thread, state, pending, check, armed } = context;
		const shown = pending ?? state.current;
		const index = shown === undefined ? -1 : state.choices.findIndex((choice) => choice.key === shown.key);
		const color = !check.available ? COLORS.muted : pending ? pendingColor(pending, thread) : COLORS.accent;
		return {
			header: `${label}${index >= 0 && state.choices.length > 1 ? ` · ${index + 1}/${state.choices.length}` : ""}`,
			icon: shown ? powerArt(shown.icon, { acpIcons: deck.acpIcons }) : glyphArt(glyph),
			accent: color,
			value: shown?.label ?? (context.control === "model" ? thread.model.model : t("strip.default")),
			detail: !check.available ? check.reason : pending ? t("strip.pressToApply") : this.#idleDetail(context.control, thread),
			detailColor: pending ? pendingColor(pending, thread) : undefined,
			tone: toneOf(thread.deck, thread.unseen),
			ultrathink: context.control === "effort" && (armed || (pending?.kind === "effort" && pending.ultrathink)),
		};
	}

	protected override list(action: Action<PowerSettings>): StripList | undefined {
		const context = this.#context(action);
		if (context.thread === undefined || disconnectedStrip("", this.machineOf(action))) return undefined;
		const { state, pending, check, thread } = context;
		const shown = pending ?? state.current;
		if (shown === undefined) return undefined;
		const listed = state.choices.some((choice) => choice.key === shown.key);
		const choices = listed ? state.choices : [shown, ...state.choices];
		const detail = !check.available ? check.reason : pending ? t("strip.pressToApply") : this.#idleDetail(context.control, thread);
		return {
			heading: t(CONTROL[context.control].label),
			index: choices.findIndex((choice) => choice.key === shown.key),
			items: choices.map((choice) => ({
				key: choice.key,
				label: choice.label,
				caption: choice.kind === "model" ? bareModelName(choice.model) : choice.label,
				art: powerArt(choice.icon, { acpIcons: deck.acpIcons }),
				color: choice.kind === "model" ? modelColor(choice.model) : choice.key === pending?.key ? COLORS.attention : undefined,
				detail: choice.key === shown.key ? detail : undefined,
			})),
			note: !check.available ? { text: check.reason } : pending ? { text: t("strip.pressToApply"), color: pendingColor(pending, thread) } : undefined,
		};
	}

	#idleDetail(control: DialControl, thread: DeckThread): string {
		const model = findModel(thread.machine.modelConfig, thread.model);
		if (control !== "model") return model?.label ?? thread.model.model;
		const toggle = speedToggle(model, thread.model);
		return toggle ? t("strip.speed", { speed: toggle.label }) : thread.title;
	}

	/** The classic face as a slider: the setting's stops with the thread's value filled and the previewed one hollow. */
	protected override slider(action: Action<PowerSettings>): SliderInput | undefined {
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
		const context = this.#context(action);
		if (context.thread === undefined || context.state.choices.length === 0) return undefined;
		const { control, thread, state, pending, check } = context;
		const shown = pending ?? state.current;
		const at = (choice: PowerChoice | undefined) => (choice === undefined ? -1 : state.choices.findIndex((candidate) => candidate.key === choice.key));
		const index = at(shown);
		const toggle = speedToggle(findModel(thread.machine.modelConfig, thread.model), thread.model);
		const model = findModel(thread.machine.modelConfig, thread.model);
		const fastPaint = speedPaint(model);
		const bolt = toggle && (toggle.fast ? paintedGlyphArt("speedFilled", fastPaint) : glyphArt("speed", COLORS.muted));
		// The model slider shows Speed along the bottom, where a tap toggles it; the others keep the bolt at the top right.
		const badges: MarkPainter[] = bolt && control === "effort" ? [bolt] : [];
		const footer = bolt && control === "model" ? { mark: bolt, text: toggle!.label, paint: toggle!.fast ? fastPaint : undefined } : undefined;
		const ends: [string, string] =
			control === "effort"
				? [t("power.quicker"), t("power.deeper")]
				: control === "permissions"
					? [t("power.asksFirst"), t("power.handsOff")]
					: ["", ""];
		const fullAccess = shown?.kind === "mode" && shown.mode === "full-access";
		const effort = shown?.kind === "model" ? modelEffort(shown.model, thread, context.armed) : undefined;
		const tone = shown?.kind === "effort" ? effortToneOf(effortChoices(model), shown.key, colorStyle(), model && modelColor(model)) : undefined;
		return {
			// The badge and the color already name the provider.
			label: shown?.kind === "model" ? bareModelName(shown.model) : (shown?.label ?? thread.model.model),
			suffix: effort,
			labelColor: shown?.kind === "model" ? modelColor(shown.model) : shown?.kind === "effort" ? (tone?.text ?? (pending ? COLORS.attention : undefined)) : pending || fullAccess ? COLORS.attention : undefined,
			stops: state.choices.length,
			current: at(state.current),
			preview: pending ? index : undefined,
			fill:
				shown?.kind === "effort" && shown.ultrathink
					? { gradient: SPECTRUM }
					: shown?.kind === "effort"
						? tone?.fill
						: state.current?.kind === "model"
							? modelFill(colorStyle(), modelColor(state.current.model))
							: undefined,
			// Models are places in a list, not levels: pills like the Model key's, not a filling track.
			pages: control === "model",
			ends,
			note: !check.available ? { text: check.reason } : pending ? { text: t("strip.pressToApply"), color: pendingColor(pending, thread) } : undefined,
			badges,
			footer,
			lead: shown?.kind === "effort" && tone ? glyphArt(CONTROL.effort.glyph, tone.text) : shown ? powerArt(shown.icon, { acpIcons: deck.acpIcons }) : glyphArt(CONTROL[control].glyph),
			dim: !check.available,
		};
	}

	protected override rotated(dial: DialAction<PowerSettings>, ticks: number): void {
		const context = this.#context(dial);
		if (context.thread === undefined) return;
		const next = stepChoice(context.state, context.pending?.key, ticks);
		context.preview.key = next?.key === context.state.current?.key ? undefined : next?.key;
	}

	protected override pressed(dial: DialAction<PowerSettings>): Promise<void> {
		return this.#act(dial, this.#context(dial).pending === undefined ? "speed" : "apply");
	}

	protected override tapped(dial: DialAction<PowerSettings>): Promise<void> {
		return this.#act(dial, "speed");
	}


	/** Applies the previewed value, or switches Speed. */
	async #act(dial: DialAction<PowerSettings>, wants: "apply" | "speed"): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const context = this.#context(dial);
		const { thread, control } = context;
		if (thread === undefined) return void (await this.allowed(dial, availability(CONTROL[control].kind, { canOperate: false })));
		const toggle = speedToggle(findModel(thread.machine.modelConfig, thread.model), thread.model);
		const speedCheck = availability("speed", { thread, canOperate: canOperate(thread) });
		const pending = context.pending;
		// A tap on a model without a Speed option, or on the Access dial, which leaves Speed alone, does nothing.
		if (wants === "speed" && (toggle === undefined || control === "permissions")) return;
		if (!(await this.allowed(dial, wants === "apply" ? context.check : speedCheck))) return;
		const work = wants === "apply" && pending ? this.#apply(thread, pending, context.armed) : undefined;
		if (wants === "apply") {
			if (work === undefined) return;
			const { preview } = context;
			return this.run(dial, async () => {
				await work();
				preview.key = undefined;
			});
		}
		if (toggle !== undefined) await this.run(dial, () => thread.machine.setModelSelection(thread, withOptionValue(thread.model, toggle.option.id, toggle.next)));
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
		const offline = disconnectedStrip(t("strip.prompts"), this.machineOf(action));
		if (offline) return offline;
		const { prompts, index, prompt } = this.#current(action);
		if (prompt === undefined) return { header: t("strip.prompts"), icon: glyphArt("spark", COLORS.muted), accent: COLORS.muted, value: t("strip.noPrompts"), detail: t("strip.addPrompts") };
		const thread = selectedThread(this.machineOf(action));
		const check = availability("send", { thread, canOperate: canOperate(thread), hasPrompt: true });
		return {
			header: `${prompt.label ?? t("face.prompt")} · ${index + 1}/${prompts.length}`,
			icon: glyphArt("spark", check.available ? COLORS.text : COLORS.muted),
			accent: check.available ? COLORS.accent : COLORS.muted,
			value: prompt.text,
			detail: check.available ? `→ ${thread!.title}` : check.reason,
			tone: toneOf(thread?.deck, thread?.unseen),
			ultrathink: ultrathinkArmed(thread),
		};
	}

	protected override list(action: Action<PromptListSettings>): StripList | undefined {
		if (disconnectedStrip(t("strip.prompts"), this.machineOf(action))) return undefined;
		const { prompts, index } = this.#current(action);
		if (prompts.length === 0) return undefined;
		const thread = selectedThread(this.machineOf(action));
		const check = availability("send", { thread, canOperate: canOperate(thread), hasPrompt: true });
		const art = glyphArt("spark", check.available ? COLORS.text : COLORS.muted);
		return {
			heading: t("strip.prompts"),
			index,
			wrap: true,
			items: prompts.map((prompt, at) => ({
				key: `${at}:${prompt.text}`,
				label: prompt.label ?? prompt.text,
				art,
				detail: at === index ? [prompt.label ? prompt.text : undefined, check.available ? `→ ${thread!.title}` : undefined].filter(Boolean).join("\n") || undefined : undefined,
			})),
			note: check.available ? undefined : { text: check.reason },
		};
	}

	protected override rotated(dial: DialAction<PromptListSettings>, ticks: number): void {
		const { prompts, index } = this.#current(dial);
		if (prompts.length > 0) this.#index.set(dial.id, (((index + ticks) % prompts.length) + prompts.length) % prompts.length);
	}

	protected override reviewScope(action: Action<PromptListSettings>): string | undefined {
		return JSON.stringify([selectedThread(this.machineOf(action))?.key ?? "", this.#current(action).prompt?.text ?? ""]);
	}

	protected override pressed(dial: DialAction<PromptListSettings>, heldMs: number): Promise<void> {
		// Under Hold, the hold confirms the send itself, so it can't also start a thread.
		const startsThread = heldMs >= LONG_PRESS_MS && this.confirmModeOf(dial) !== "hold";
		return this.#send(dial, heldMs, this.#reviewed(dial) ?? (startsThread ? "new" : "send"));
	}

	protected override tapped(dial: DialAction<PromptListSettings>): Promise<void> {
		return this.#send(dial, 0, this.#reviewed(dial) ?? "send");
	}

	/** The gesture a showing review was for: the second press confirms that, whatever its own. */
	#reviewed(dial: DialAction<PromptListSettings>): "send" | "new" | undefined {
		const detail = this.reviewed(dial, this.reviewScope(dial));
		return detail === "send" || detail === "new" ? detail : undefined;
	}

	/** Sends the prompt to the selected thread, or starts a thread with it, once the Confirm setting allows. */
	async #send(dial: DialAction<PromptListSettings>, held: number, wants: "send" | "new"): Promise<void> {
		const machine = this.machineOf(dial);
		if (await pressWhileDisconnected(machine)) return;
		const text = this.#current(dial).prompt?.text;
		const thread = selectedThread(machine);
		const check =
			wants === "new"
				? availability("new", { canOperate: launchable(thread, machine), hasPrompt: text !== undefined })
				: availability("send", { thread, canOperate: canOperate(thread), hasPrompt: text !== undefined });
		if (!(await this.allowed(dial, check))) return;
		const go = await this.guard(dial, {
			scope: this.reviewScope(dial)!,
			detail: wants,
			held,
			holdHint: t("result.holdToSend"),
			card: () => ({
				glyph: "spark",
				verb: t(wants === "new" ? "review.newThread" : "review.send"),
				target: wants === "new" ? thread?.projectTitle || t("datasource.noProject") : thread!.title,
				body: text,
				footer: t("review.pressToSend"),
			}),
		});
		if (go === undefined) return;
		if (go === "new") return this.run(dial, () => startThread(thread, machine, text!));
		if (!(await this.allowed(dial, availability("send", { thread, canOperate: canOperate(thread), hasPrompt: text !== undefined })))) return;
		await this.run(dial, () => sendToThread(thread!, text!, "auto"));
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

/** A question's choice number, drawn where other items have a glyph. */
const numberArt =
	(n: number, color: string): MarkPainter =>
	(x, y, size) =>
		`<circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2 - 1}" fill="none" stroke="${color}" stroke-width="${Math.max(1.5, size / 14)}"/>` +
		svgText(String(n), x + size / 2, y + size / 2 + size * 0.2, Math.round(size * 0.56), 700, color, ` text-anchor="middle"`);

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
		const offline = disconnectedStrip(t("strip.answer"), this.machineOf(dial));
		if (offline) return offline;
		const settings = this.settingsOf(dial);
		const thread = this.#target(this.machineOf(dial));
		if (thread === undefined) {
			this.#answers.delete(dial.id);
			return {
				header: t("strip.answer"),
				icon: glyphArt("check", COLORS.muted),
				accent: COLORS.muted,
				value: t("strip.nothingPending"),
				detail: t("strip.approvals", { authority: authorityLabel(approvalAuthority(settings.approvalAuthority)) }),
			};
		}
		const approval = thread.deck === "approval";
		const answering = this.#answering(dial, thread);
		const waiting: StripContent = { header: t(approval ? "strip.approval" : "strip.question"), icon: glyphArt(approval ? "shield" : "question", COLORS.attention), accent: COLORS.attention, value: thread.title, tone: "attention" };
		if (answering === undefined) return { ...waiting, loading: true };
		const { request, step, picks } = answering;
		const canAct = canOperate(thread);
		switch (request.type) {
			case "unsupported":
				return { ...waiting, header: request.heading, detail: t("strip.pressToOpen") };
			case "approval": {
				const press = this.#choices(dial, request)[picks[0] ?? 0];
				const check = press.kind === "open" ? undefined : availability(press.decision === "decline" ? "deny" : "approve", { thread, canOperate: canAct });
				const hold = press.kind === "respond" && approvalConfirm(settings.approvalConfirm) === "hold";
				const { glyph, color } = check?.available === false ? { glyph: "shield" as const, color: COLORS.muted } : PRESS_FACE(press);
				return {
					header: request.heading,
					icon: glyphArt(glyph, color),
					accent: color,
					value: request.summary || thread.title,
					detail: check?.available === false ? check.reason : hold ? t("strip.withHold", { label: press.label }) : press.label,
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
					header: `${question?.header || t("strip.question")}${request.questions.length > 1 ? ` · ${step + 1}/${request.questions.length}` : ""}`,
					icon: glyphArt("question", unavailable ? COLORS.muted : COLORS.attention),
					accent: unavailable ? COLORS.muted : COLORS.attention,
					value: option?.label ?? t("strip.openInT3Code"),
					detail: unavailable ? check.reason : (question?.question ?? ""),
					tone: "attention",
				};
			}
		}
	}

	protected override list(dial: Action<AnswerSettings>): StripList | undefined {
		if (disconnectedStrip(t("strip.answer"), this.machineOf(dial))) return undefined;
		const thread = this.#target(this.machineOf(dial));
		const answering = thread === undefined ? undefined : this.#answering(dial, thread);
		if (thread === undefined || answering === undefined) return undefined;
		const { request, step, picks } = answering;
		const canAct = canOperate(thread);
		if (request.type === "approval") {
			const hold = approvalConfirm(this.settingsOf(dial).approvalConfirm) === "hold";
			const about = request.summary || thread.title;
			const items = this.#choices(dial, request).map((press, at): StripItem => {
				const check = press.kind === "open" ? undefined : availability(press.decision === "decline" ? "deny" : "approve", { thread, canOperate: canAct });
				const { glyph, color } = check?.available === false ? { glyph: "shield" as const, color: COLORS.muted } : PRESS_FACE(press);
				const label = press.kind === "respond" && hold ? t("strip.withHold", { label: press.label }) : press.label;
				return { key: `${at}:${press.label}`, label, art: glyphArt(glyph, color), tint: color, detail: check?.available === false ? check.reason : undefined };
			});
			const selected = items[picks[0] ?? 0];
			return { heading: request.heading, items, index: picks[0] ?? 0, note: { text: selected?.detail ?? about, color: COLORS.muted } };
		}
		if (request.type !== "question") return undefined;
		const question = request.questions[step];
		if (question === undefined || question.options.length === 0) return undefined;
		const check = availability("answer", { thread, canOperate: canAct });
		const color = check.available ? COLORS.attention : COLORS.muted;
		return {
			heading: `${question.header || t("strip.question")}${request.questions.length > 1 ? ` · ${step + 1}/${request.questions.length}` : ""}`,
			items: question.options.map((option, at) => ({ key: `${step}:${at}`, label: option.label, art: numberArt(at + 1, color), tint: color })),
			index: picks[step] ?? 0,
			note: { text: check.available ? question.question : check.reason, color: COLORS.muted },
		};
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
		if (request.type === "unsupported") return void (await this.run(dial, () => openThread(thread)));
		if (request.type === "approval") {
			const press = this.#choices(dial, request)[picks[0] ?? 0];
			if (press.kind === "open") return void (await this.run(dial, () => openThread(thread)));
			if (!(await this.allowed(dial, availability(press.decision === "decline" ? "deny" : "approve", { thread, canOperate: canOperate(thread) })))) return;
			if (!confirmed(press, approvalConfirm(this.settingsOf(dial).approvalConfirm), held)) return void (await this.flash(dial, false, t("result.holdToAnswer")));
			return void (await this.run(dial, () => thread.machine.respond(request.threadId, request.requestId, press.decision)));
		}
		const answerable = request.questions[answering.step]?.options.length ?? 0;
		if (answerable === 0) return void (await this.run(dial, () => openThread(thread)));
		if (answering.step < request.questions.length - 1) {
			answering.step += 1;
			return void (await this.paint(dial));
		}
		if (!(await this.allowed(dial, availability("answer", { thread, canOperate: canOperate(thread) })))) return;
		await this.run(dial, () => thread.machine.answer(request.threadId, request.requestId, buildAnswers(request.questions, picks, request.messageMode)));
	}

	protected override async tapped(dial: DialAction<AnswerSettings>): Promise<void> {
		const thread = this.#target(this.machineOf(dial));
		if (thread !== undefined) await this.run(dial, () => openThread(thread));
	}

	override onWillDisappear(ev: Parameters<StripDial<AnswerSettings>["onWillDisappear"]>[0]): void {
		this.#answers.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}
