import { describe, expect, it, vi } from "vitest";

import { findModel, type ModelConfig } from "./models.js";
import { effortGradient, sampleStops } from "./render.js";
import type { DeckThread } from "./board.js";
import { applyChoice, dialControl, effortChoices, effortToneOf, isTopEffort, powerArt, powerState, stepChoice } from "./power.js";


const effort = { id: "effort", label: "Effort", type: "select" as const, options: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }, { id: "ultrathink", label: "Ultrathink" }], promptInjectedValues: ["ultrathink"] };
const CONFIG: ModelConfig = {
	providers: [
		{ instanceId: "codex", driver: "codex", models: [{ slug: "gpt-5.5", name: "GPT-5.5" }] },
		{ instanceId: "claudeAgent", driver: "claudeAgent", supportedRuntimeModes: ["approval-required", "auto", "full-access"], models: [{ slug: "opus", name: "Opus", capabilities: { optionDescriptors: [effort] } }] },
	],
	settings: { favorites: [{ provider: "claudeAgent", model: "opus" }, { provider: "codex", model: "gpt-5.5" }] },
};
const thread = { model: { instanceId: "claudeAgent", model: "opus" }, runtimeMode: "auto" as const };

describe("Power dial", () => {
	it("controls the model unless set to effort or permissions", () => {
		expect([dialControl(undefined), dialControl("effort"), dialControl("permissions"), dialControl("power")]).toEqual(["model", "effort", "permissions", "model"]);
	});

	it("turns through T3 Code's favorites across providers, each shown with its provider mark and T3's label", () => {
		const state = powerState("model", CONFIG, thread);
		expect(state.choices.map((choice) => choice.label)).toEqual(["Codex · GPT-5.5", "Claude · Opus"]);
		expect(state.current?.key).toBe("claudeAgent:opus");
		expect(state.choices.map((choice) => choice.icon.kind === "mark" && choice.icon.model.driver)).toEqual(["codex", "claudeAgent"]);
		const previewed = stepChoice(state, undefined, -1)!;
		expect(previewed.label).toBe("Codex · GPT-5.5");
		expect(powerArt(previewed.icon)(0, 0, 38)).not.toBe(powerArt(state.current!.icon)(0, 0, 38));
	});

	it("shows a model outside the favorites as current without listing it", () => {
		const state = powerState("model", { ...CONFIG, settings: { favorites: [{ provider: "codex", model: "gpt-5.5" }] } }, thread);
		expect(state.choices).toHaveLength(1);
		expect(state.current?.label).toBe("Claude · Opus");
		expect(stepChoice(state, undefined, 1)?.label).toBe("Codex · GPT-5.5");
	});

	it("uses T3 Code's mode icon for each access mode the provider supports", () => {
		const state = powerState("permissions", CONFIG, thread);
		expect(state.choices.map((choice) => [choice.label, choice.icon.kind === "glyph" && choice.icon.name])).toEqual([
			["Supervised", "modeSupervised"],
			["Auto", "modeAuto"],
			["Full access", "modeFullAccess"],
		]);
		expect(state.current?.label).toBe("Auto");
		expect(stepChoice(state, undefined, 5)?.label).toBe("Full access");
		expect(stepChoice(state, "approval-required", -1)?.label).toBe("Supervised");
	});

	it("turns through the model's efforts with the effort icon, showing Ultrathink while armed", () => {
		const state = powerState("effort", CONFIG, thread);
		expect(state.choices.map((choice) => choice.label)).toEqual(["Low", "High", "Ultrathink"]);
		expect(state.choices.every((choice) => choice.icon.kind === "glyph" && choice.icon.name === "effort")).toBe(true);
		expect(state.current?.label).toBe("High");
		expect(powerState("effort", CONFIG, thread, true).current?.label).toBe("Ultrathink");
		expect(powerState("effort", CONFIG, { ...thread, model: { instanceId: "codex", model: "gpt-5.5" } }).missing).toBe("No effort");
	});

	it("leaves out levels that only prefix a prompt, for a host that sends none of yours", () => {
		const state = powerState("effort", CONFIG, thread, false, { promptInjected: false });
		expect(state.choices.map((choice) => choice.label)).toEqual(["Low", "High"]);
		expect(state.current?.label).toBe("High");
		expect(effortChoices(findModel(CONFIG, thread.model), { promptInjected: false }).map((choice) => choice.label)).toEqual(["Low", "High"]);
	});
});

describe("isTopEffort", () => {
	const level = (key: string, ultrathink = false) => ({ kind: "effort" as const, key, label: key, icon: { kind: "glyph" as const, name: "effort" as const }, optionId: "effort", value: key, ultrathink });
	it("is the last level before Ultrathink, and only on a ladder", () => {
		const choices = [level("low"), level("high"), level("max"), level("ultrathink", true)];
		expect(isTopEffort(choices, "max")).toBe(true);
		expect(isTopEffort(choices, "high")).toBe(false);
		expect(isTopEffort(choices, "ultrathink")).toBe(false);
		expect(isTopEffort([level("max")], "max")).toBe(false);
	});
});

describe("effortToneOf", () => {
	const level = (key: string, ultrathink = false) => ({ kind: "effort" as const, key, label: key, icon: { kind: "glyph" as const, name: "effort" as const }, optionId: "effort", value: key, ultrathink });
	const choices = [level("low"), level("medium"), level("high"), level("ultrathink", true)];

	it("colors a level by how far up its ladder it sits, Ultrathink aside", () => {
		const gradient = effortGradient("#3366FF");
		expect(effortToneOf(choices, "low", "gradient", "#3366FF")?.text).toBe(sampleStops(gradient, 0));
		expect(effortToneOf(choices, "medium", "gradient", "#3366FF")?.text).toBe(sampleStops(gradient, 0.5));
		expect(effortToneOf(choices, "high", "gradient", "#3366FF")?.text).toBe(sampleStops(gradient, 1));
	});

	it("marks only the top level under the solid style", () => {
		expect(effortToneOf(choices, "high", "solid", undefined)).toBeDefined();
		expect(effortToneOf(choices, "medium", "solid", undefined)).toBeUndefined();
	});

	it("leaves Ultrathink and unknown levels uncolored", () => {
		expect(effortToneOf(choices, "ultrathink", "gradient", "#3366FF")).toBeUndefined();
		expect(effortToneOf(choices, "max", "gradient", "#3366FF")).toBeUndefined();
		expect(effortToneOf(choices, undefined, "gradient", "#3366FF")).toBeUndefined();
	});
});

describe("applyChoice", () => {
	const setup = (armed = false) => {
		const machine = { modelConfig: CONFIG, setModelSelection: vi.fn(async () => undefined), setRuntimeMode: vi.fn(async () => undefined) };
		const target = { ...thread, threadId: "t1", machine: machine as unknown as DeckThread["machine"] };
		const ultrathink = { armed, arm: vi.fn(), disarm: vi.fn() };
		const choice = (control: "effort" | "permissions", key: string) => powerState(control, CONFIG, thread).choices.find((each) => each.key === key)!;
		return { machine, target, ultrathink, choice };
	};

	it("sets a mode", async () => {
		const { machine, target, ultrathink, choice } = setup();
		await applyChoice(target, choice("permissions", "auto"), ultrathink)?.();
		expect(machine.setRuntimeMode).toHaveBeenCalledWith(target, "auto");
	});

	it("sets an effort and disarms Ultrathink", async () => {
		const { machine, target, ultrathink, choice } = setup(true);
		await applyChoice(target, choice("effort", "low"), ultrathink)?.();
		expect(machine.setModelSelection).toHaveBeenCalledWith(target, { ...thread.model, options: [{ id: "effort", value: "low" }] });
		expect(ultrathink.disarm).toHaveBeenCalled();
		expect(machine.setModelSelection.mock.invocationCallOrder[0]).toBeLessThan(ultrathink.disarm.mock.invocationCallOrder[0]!);
	});

	it("arms Ultrathink instead of sending", async () => {
		const { machine, target, ultrathink, choice } = setup();
		await applyChoice(target, choice("effort", "ultrathink"), ultrathink)?.();
		expect(ultrathink.arm).toHaveBeenCalled();
		expect(machine.setModelSelection).not.toHaveBeenCalled();
		expect(machine.setRuntimeMode).not.toHaveBeenCalled();
	});

	it("does nothing for Ultrathink while it's armed", () => {
		const { target, ultrathink, choice } = setup(true);
		expect(applyChoice(target, choice("effort", "ultrathink"), ultrathink)).toBeUndefined();
	});

	it("only disarms for the thread's own effort while Ultrathink is armed", async () => {
		const { machine, target, ultrathink, choice } = setup(true);
		await applyChoice(target, choice("effort", "high"), ultrathink)?.();
		expect(ultrathink.disarm).toHaveBeenCalled();
		expect(machine.setModelSelection).not.toHaveBeenCalled();
	});

	it("does nothing for the current effort", () => {
		const { target, ultrathink, choice } = setup();
		expect(applyChoice(target, choice("effort", "high"), ultrathink)).toBeUndefined();
	});
});
