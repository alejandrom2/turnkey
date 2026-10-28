/**
 * What the Power dial turns through: models (T3 Code's favorites across providers), the thread model's efforts with
 * Ultrathink, or access modes. Each choice carries the icon the strip shows while it is previewed or current.
 */
import type { DeckThread } from "./board.js";
import { type AcpIcons, type CatalogModel, currentOptionValue, effortOption, findModel, type ModelConfig, pickableModels, providerMark, runtimeModes, switchSelection, withOptionValue } from "./models.js";
import { t } from "./i18n.js";
import { COLORS, effortTone, type GlyphName, glyphArt, type MarkPainter, type MaxEffortStyle, MODE_GLYPH } from "./render.js";
import type { ModelSelection, OptionValue, RuntimeMode } from "./t3/shell.js";
import { ULTRATHINK } from "./ultrathink.js";

export type DialControl = "model" | "effort" | "permissions";

export const dialControl = (value: unknown): DialControl => (value === "effort" || value === "permissions" ? value : "model");

export type PowerIcon = { kind: "mark"; model: CatalogModel } | { kind: "glyph"; name: GlyphName };

export type PowerChoice =
	| { kind: "model"; key: string; label: string; icon: PowerIcon; model: CatalogModel }
	| { kind: "effort"; key: string; label: string; icon: PowerIcon; optionId: string; value: OptionValue; ultrathink: boolean }
	| { kind: "mode"; key: string; label: string; icon: PowerIcon; mode: RuntimeMode };

export type PowerState = {
	choices: PowerChoice[];
	/** The thread's current value: in `choices`, or standing alone (a model outside the favorites). */
	current: PowerChoice | undefined;
	/** Why there is nothing to turn through. */
	missing?: string;
};

type Thread = { model: ModelSelection; runtimeMode: RuntimeMode };

const EFFORT_ICON: PowerIcon = { kind: "glyph", name: "effort" };

/** The thread model's efforts in T3 Code's order, then its prompt-injected ones (Ultrathink). */
export function effortChoices(model: Pick<CatalogModel, "options"> | undefined): Extract<PowerChoice, { kind: "effort" }>[] {
	const option = effortOption(model);
	if (option === undefined) return [];
	const choice = (value: OptionValue, label: string, ultrathink: boolean) => ({ kind: "effort" as const, key: String(value), label, icon: EFFORT_ICON, optionId: option.id, value, ultrathink });
	return [...option.values.map((value) => choice(value.value, value.label, false)), ...(option.injected ?? []).map((value) => choice(value.value, value.label, value.value === ULTRATHINK))];
}

/** Whether `key` is the model's top effort level (Ultrathink aside), when it has more than one. */
export function isTopEffort(choices: readonly Extract<PowerChoice, { kind: "effort" }>[], key: string | undefined): boolean {
	const levels = choices.filter((choice) => !choice.ultrathink);
	return levels.length > 1 && key !== undefined && levels.at(-1)?.key === key;
}

/** How effort level `key` is colored, by where it sits on its model's ladder; undefined for Ultrathink or an unknown level. */
export function effortToneOf(choices: readonly Extract<PowerChoice, { kind: "effort" }>[], key: string | undefined, style: MaxEffortStyle, modelColor: string | undefined) {
	const place = effortPlace(choices, key);
	if (place === undefined || choices.some((choice) => choice.key === key && choice.ultrathink)) return undefined;
	return effortTone(style, place, isTopEffort(choices, key), modelColor);
}

/** How far up its model's ladder effort level `key` sits, 0 to 1; Ultrathink, above the ladder, is 1. */
export function effortPlace(choices: readonly Extract<PowerChoice, { kind: "effort" }>[], key: string | undefined): number | undefined {
	const choice = choices.find((candidate) => candidate.key === key);
	if (choice === undefined) return undefined;
	if (choice.ultrathink) return 1;
	const levels = choices.filter((candidate) => !candidate.ultrathink);
	return levels.length > 1 ? levels.indexOf(choice) / (levels.length - 1) : 1;
}

/** The effort a thread shows: Ultrathink while armed, else its option's value. */
export function currentEffort(model: Pick<CatalogModel, "options"> | undefined, selection: ModelSelection, armed: boolean): OptionValue | undefined {
	const option = effortOption(model);
	if (option === undefined) return undefined;
	return armed && option.injected?.some((value) => value.value === ULTRATHINK) ? ULTRATHINK : currentOptionValue(selection, option);
}

/** What picking `value` does: arm Ultrathink (nothing sent), or disarm and set the option (unless it is already set). */
export function effortChange(
	model: Pick<CatalogModel, "options"> | undefined,
	selection: ModelSelection,
	value: OptionValue,
): { kind: "arm" } | { kind: "set"; optionId: string; value: OptionValue; send: boolean } | undefined {
	const option = effortOption(model);
	if (option === undefined) return undefined;
	if (option.injected?.some((injected) => injected.value === value)) return value === ULTRATHINK ? { kind: "arm" } : undefined;
	if (!option.values.some((choice) => choice.value === value)) return undefined;
	return { kind: "set", optionId: option.id, value, send: currentOptionValue(selection, option) !== value };
}

/** A host's Ultrathink for one thread. */
export type UltrathinkControl = { armed: boolean; arm(): void; disarm(): void };

/** What picking `choice` does to `thread`; undefined when nothing changes. */
export function applyChoice(thread: Pick<DeckThread, "model" | "threadId" | "machine">, choice: PowerChoice, ultrathink: UltrathinkControl): (() => Promise<unknown>) | undefined {
	switch (choice.kind) {
		case "model":
			return () => thread.machine.setModelSelection(thread, switchSelection(choice.model, thread.model));
		case "mode":
			return () => thread.machine.setRuntimeMode(thread, choice.mode);
		case "effort": {
			const change = effortChange(findModel(thread.machine.modelConfig, thread.model), thread.model, choice.value);
			if (change === undefined) return undefined;
			if (change.kind === "arm") return ultrathink.armed ? undefined : async () => ultrathink.arm();
			if (!change.send && !ultrathink.armed) return undefined;
			return async () => {
				if (change.send) await thread.machine.setModelSelection(thread, withOptionValue(thread.model, change.optionId, change.value));
				ultrathink.disarm();
			};
		}
	}
}

const modelChoice = (model: CatalogModel): PowerChoice => ({ kind: "model", key: model.key, label: model.label, icon: { kind: "mark", model }, model });

export function powerState(control: DialControl, config: ModelConfig | undefined, thread: Thread, ultrathinkArmed = false): PowerState {
	const model = findModel(config, thread.model);
	switch (control) {
		case "model": {
			const choices = pickableModels(config).map(modelChoice);
			const key = `${thread.model.instanceId}:${thread.model.model}`;
			const current = choices.find((choice) => choice.key === key) ?? (model === undefined ? undefined : modelChoice(model));
			return { choices, current, missing: choices.length === 0 ? t("reason.noModels") : undefined };
		}
		case "effort": {
			const choices = effortChoices(model);
			const value = currentEffort(model, thread.model, ultrathinkArmed);
			return { choices, current: choices.find((choice) => choice.key === String(value)), missing: choices.length === 0 ? t("reason.noEffort") : undefined };
		}
		case "permissions": {
			const choices = runtimeModes(config, thread.model.instanceId).map(
				(mode): PowerChoice => ({ kind: "mode", key: mode.value, label: mode.label, icon: { kind: "glyph", name: MODE_GLYPH[mode.value] }, mode: mode.value }),
			);
			return { choices, current: choices.find((choice) => choice.key === thread.runtimeMode), missing: choices.length < 2 ? t("reason.noModes") : undefined };
		}
	}
}

/** The choice `ticks` away from `from` (the preview, else the current one), clamped to the ends. */
export function stepChoice(state: PowerState, from: string | undefined, ticks: number): PowerChoice | undefined {
	const { choices } = state;
	if (choices.length === 0) return undefined;
	const index = choices.findIndex((choice) => choice.key === (from ?? state.current?.key));
	const start = index === -1 ? (ticks > 0 ? -1 : choices.length) : index;
	return choices[Math.min(choices.length - 1, Math.max(0, start + ticks))];
}

type IconOptions = { color?: string; acpIcons?: Pick<AcpIcons, "get"> };

/** A choice's art: the model's provider mark (ACP icon and initials badge included), or a white glyph. */
export function powerArt(icon: PowerIcon, options: IconOptions = {}): MarkPainter {
	if (icon.kind === "glyph") return glyphArt(icon.name, options.color ?? COLORS.text);
	return (x, y, size) => providerMark(icon.model, x, y, size, { acpIcons: options.acpIcons });
}

/** The strip icon for a choice. */
