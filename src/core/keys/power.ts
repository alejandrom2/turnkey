import { type Availability, availability } from "../availability.js";
import type { DeckThread } from "../board.js";
import { t } from "../i18n.js";
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
	pickableModels,
	RUNTIME_MODES,
	runtimeModes,
	speedToggle,
	switchSelection,
	withOptionValue,
} from "../models.js";
import { twinkleStep } from "../motion.js";
import { applyChoice, currentEffort, type DialControl, effortChoices, effortPlace, effortToneOf, powerArt, powerState, type UltrathinkControl } from "../power.js";
import {
	accessTone,
	COLORS,
	dotsCue,
	ladderCue,
	type MaxEffortStyle,
	maxEffortStyle,
	modelFill,
	MODE_GLYPH,
	type Paint,
	paintedGlyphArt,
	providerGradient,
	renderControlKey,
} from "../render.js";
import { effortFace, modeFace, modelFace } from "../ring.js";
import type { RuntimeMode } from "../t3/shell.js";
import { ultrathinkControl } from "../ultrathink.js";
import { canOperate, type KeyContext, type KeyDefinition, type PressPlan } from "./key.js";

/** A setting key's state: its face, whether it can act, and what a press applies (undefined: already current). */
export type SettingState = { thread: DeckThread | undefined; face: string; check: Availability; apply?: () => Promise<unknown>; moving?: boolean };

/** The thread the key acts on, with its machine's model config. */
function selection(ctx: KeyContext<unknown>) {
	const target = ctx.target();
	return { ...target, config: target.thread?.machine.modelConfig };
}

function applying({ check, apply }: SettingState): PressPlan {
	if (!check.available) return { kind: "fail", label: check.reason };
	return apply === undefined ? { kind: "nothing" } : { kind: "run", work: apply };
}

const colorStyle = (ctx: KeyContext<unknown>): MaxEffortStyle => maxEffortStyle(ctx.runtime.appearance().maxEffort);

/** A model's provider mark, as the Model key draws it. */
const markArt = (ctx: KeyContext<unknown>, model: CatalogModel) => powerArt({ kind: "mark", model }, { acpIcons: ctx.runtime.acpIcons });

/** Fast's paint: the model's gradient (or its color), the accent for white marks unless gradients are on. */
export const speedPaint = (model: CatalogModel | undefined, style: MaxEffortStyle): Paint => {
	const color = model && modelColor(model);
	return style === "gradient" ? { gradient: providerGradient(color ?? COLORS.accent) } : (color ?? COLORS.accent);
};

const NO_ULTRATHINK: UltrathinkControl = { armed: false, arm: () => undefined, disarm: () => undefined };

/** Whether Ultrathink is armed for `thread` and its model still offers it. */
const ultrathinkArmed = (ctx: KeyContext<unknown>, thread: DeckThread | undefined): boolean =>
	thread !== undefined && ctx.runtime.ultrathink?.armed(thread.key, findModel(thread.machine.modelConfig, thread.model)) === true;

/**
 * The Ring's model, effort or access for the thread, as Logitech has always read it: only a thread whose machine lets
 * it change them, and no prompt-only efforts.
 */
function ringPower(thread: DeckThread | undefined, control: DialControl) {
	return thread?.machine.canOperate ? { thread, state: powerState(control, thread.machine.modelConfig, thread, false, { promptInjected: false }) } : undefined;
}

export type ModelSettings = { model?: string; machine?: string; nameColor?: string; pickerSlot?: number };

/** Logitech's Model n: the model at place n, from 1, in T3 Code's picker, and the thread's own model's key. */
function pickerChoice(thread: DeckThread | undefined, place: number | undefined) {
	const state = ringPower(thread, "model")?.state;
	const choice = state?.choices[(place ?? 0) - 1];
	return { choice: choice?.kind === "model" ? choice : undefined, current: state?.current?.key };
}

/**
 * Switches the selected thread to one favorite model, or to the next of T3 Code's favorites (else of its
 * provider's models), or to the model at a place in T3 Code's picker. Another provider's model hands the thread
 * over the way T3 Code's picker does.
 */
export const modelKey: KeyDefinition<ModelSettings, SettingState> = {
	state(ctx) {
		const { thread, config, gone, pinned } = selection(ctx);
		const { pickerSlot } = ctx.settings;
		const fixed = parseModelKey(ctx.settings.model);
		const chosen = fixed !== undefined || pickerSlot !== undefined;
		const current = thread && findModel(config, thread.model);
		const catalog = thread ? modelCatalog(config, thread.model) : [];
		const target = thread === undefined ? undefined : pickerSlot !== undefined ? pickableModels(config)[pickerSlot - 1] : fixed ? findModel(config, fixed) : nextModel(catalog, thread.model);
		const missing = chosen ? (target === undefined ? t("reason.unavailable") : undefined) : catalog.length === 0 ? t("reason.noModels") : undefined;
		const check = availability("model", { thread, gone, canOperate: canOperate(ctx, thread), missing });
		const shown = chosen ? target : current;
		const label = shown?.name ?? (fixed ? fixed.model : (thread?.model.model ?? t("face.model")));
		const position = shown === undefined ? -1 : catalog.findIndex((model) => model.key === shown.key);
		// The shown model's pill takes its color, as on the Power dial.
		const cue = catalog.length > 1 && position >= 0 ? dotsCue(catalog.length, position, modelFill(colorStyle(ctx), shown && modelColor(shown))) : undefined;
		// The name takes the model's color unless the key's Name color is White.
		const labelColor = ctx.settings.nameColor === "white" ? undefined : shown && modelColor(shown);
		const face = renderControlKey({ glyph: "model", mark: shown && markArt(ctx, shown), label, labelColor, available: check.available, active: chosen && target?.key === current?.key, cue, pinned });
		if (thread === undefined || target === undefined) return { thread, face, check };
		const already = target.instanceId === thread.model.instanceId && target.slug === thread.model.model;
		return { thread, face, check, apply: already ? undefined : () => thread.machine.setModelSelection(thread, switchSelection(target, thread.model)) };
	},
	tile: (state) => state.face,
	glyph({ thread }, ctx) {
		const { choice, current } = pickerChoice(thread, ctx.settings.pickerSlot);
		return modelFace(choice?.model, choice !== undefined && choice.key === current);
	},
	label: ({ thread }, ctx) => pickerChoice(thread, ctx.settings.pickerSlot).choice?.model.label,
	available: (state) => state.check.available,
	press: applying,
};

export type EffortSettings = { effort?: string; machine?: string };

/**
 * Sets the selected thread's reasoning effort to one value, or steps through the values its model offers. Ultrathink
 * arms T3 Code's prompt prefix for the thread's next sends from the host instead of changing the effort.
 */
export const effortKey: KeyDefinition<EffortSettings, SettingState> = {
	state(ctx) {
		const { thread, config, gone, pinned } = selection(ctx);
		const fixed = ctx.settings.effort || undefined;
		const model = thread && findModel(config, thread.model);
		const armed = ultrathinkArmed(ctx, thread);
		// Ultrathink only prefixes prompts the host sends itself.
		const choices = effortChoices(model, { promptInjected: ctx.runtime.ultrathink !== undefined });
		const values = choices.map((choice) => choice.value);
		const current = thread && currentEffort(model, thread.model, armed);
		const missing = choices.length === 0 ? t("reason.noEffort") : fixed !== undefined && !values.includes(fixed) ? t("reason.notOffered") : undefined;
		const check = availability("effort", { thread, gone, canOperate: canOperate(ctx, thread), missing });
		const labelOf = (value: unknown) =>
			choices.find((choice) => choice.value === value)?.label ??
			effortValues(config).find((choice) => choice.value === value)?.label ??
			(typeof value === "string" ? value.charAt(0).toUpperCase() + value.slice(1) : t("face.effort"));
		const shown = fixed ?? current;
		const step = choices.findIndex((choice) => choice.value === shown);
		const max = effortToneOf(choices, choices[step]?.key, colorStyle(ctx), model && modelColor(model));
		// The upper half of the ladder glitters, twinkling as Motion allows.
		const place = effortPlace(choices, choices[step]?.key);
		const twinkle = place !== undefined && place >= 0.5 ? twinkleStep(ctx.runtime.motion(), Date.now()) : undefined;
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
		if (thread === undefined || choice === undefined) return { thread, face, check, moving };
		const ultrathink = ctx.runtime.ultrathink ? ultrathinkControl(ctx.runtime.ultrathink, thread.key, armed) : NO_ULTRATHINK;
		return { thread, face, check, moving, apply: applyChoice(thread, choice, ultrathink) };
	},
	tile: (state) => state.face,
	/** Its glyph over one dot per level, filled up to the current one, in Stream Deck's default effort colors: Logi has no Colors setting. */
	glyph({ thread }) {
		const power = ringPower(thread, "effort");
		if (power === undefined || power.state.choices.length < 2) return effortFace(undefined);
		const { state } = power;
		const index = Math.max(state.choices.findIndex((choice) => choice.key === state.current?.key), 0);
		const model = findModel(power.thread.machine.modelConfig, power.thread.model);
		const tone = effortToneOf(effortChoices(model, { promptInjected: false }), state.current?.key, "gradient", model && modelColor(model));
		return effortFace({ index, count: state.choices.length, color: tone?.text ?? COLORS.accent });
	},
	label: ({ thread }) => ringPower(thread, "effort")?.state.current?.label,
	available: (state) => state.check.available,
	moving: (state) => state.moving === true,
	press: applying,
};

/** Toggles the selected thread's fast mode (Claude's Fast mode, Codex's Fast tier) where its model offers one. */
export const speedKey: KeyDefinition<Record<string, unknown>, SettingState> = {
	state(ctx) {
		const { thread, config, gone, pinned } = selection(ctx);
		const model = thread && findModel(config, thread.model);
		const toggle = thread && speedToggle(model, thread.model);
		const check = availability("speed", { thread, gone, canOperate: canOperate(ctx, thread), missing: toggle === undefined ? t("reason.noFastMode") : undefined });
		const fast = toggle?.fast === true;
		// Just the bolt: outlined at Standard, filled in the model's color at Fast.
		const face = renderControlKey({ glyph: fast ? "speedFilled" : "speed", mark: fast ? paintedGlyphArt("speedFilled", speedPaint(model, colorStyle(ctx))) : undefined, available: check.available, pinned });
		if (thread === undefined || toggle === undefined) return { thread, face, check };
		return {
			thread,
			face,
			check,
			apply: () => thread.machine.setModelSelection(thread, withOptionValue(thread.model, toggle.option.id, toggle.next)),
		};
	},
	tile: (state) => state.face,
	available: (state) => state.check.available,
	press: applying,
};

export type PermissionSettings = { mode?: string; machine?: string };

/** Sets the selected thread's access (Supervised … Full access), or steps through the modes its provider supports. */
export const permissionsKey: KeyDefinition<PermissionSettings, SettingState> = {
	state(ctx) {
		const { thread, config, gone, pinned } = selection(ctx);
		const fixed = RUNTIME_MODES.find((mode) => mode === ctx.settings.mode);
		const values = thread ? runtimeModes(config, thread.model.instanceId).map((mode) => mode.value) : [];
		const current = thread?.runtimeMode;
		const shown = fixed ?? current ?? "approval-required";
		const missing = fixed !== undefined && !values.includes(fixed) ? t("reason.notOffered") : undefined;
		const check = availability("permissions", { thread, gone, canOperate: canOperate(ctx, thread), missing });
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
		if (thread === undefined || next === undefined) return { thread, face, check };
		return { thread, face, check, apply: next === current ? undefined : () => thread.machine.setRuntimeMode(thread, next) };
	},
	tile: (state) => state.face,
	glyph: ({ thread }) => modeFace(ringPower(thread, "permissions")?.thread.runtimeMode),
	label: ({ thread }) => ringPower(thread, "permissions")?.state.current?.label,
	available: (state) => state.check.available,
	press: applying,
};

/** Switches the selected thread between Build and Plan. */
export const planKey: KeyDefinition<Record<string, unknown>, SettingState> = {
	state(ctx) {
		const { thread, config, gone, pinned } = selection(ctx);
		const toggle = thread === undefined ? undefined : config?.providers?.find((provider) => provider.instanceId === thread.model.instanceId)?.showInteractionModeToggle;
		const check = availability("plan", { thread, gone, canOperate: canOperate(ctx, thread), missing: toggle === false ? t("reason.noPlanMode") : undefined });
		const planning = thread?.interactionMode === "plan";
		const face = renderControlKey({ glyph: planning ? "modePlan" : "modeBuild", label: t(planning ? "face.plan" : "face.build"), available: check.available, active: planning, pinned });
		if (thread === undefined) return { thread, face, check };
		return { thread, face, check, apply: () => thread.machine.setInteractionMode(thread, planning ? "default" : "plan") };
	},
	tile: (state) => state.face,
	available: (state) => state.check.available,
	press: applying,
};
