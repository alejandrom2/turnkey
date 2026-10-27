import { describe, expect, it } from "vitest";

import type { ModelConfig } from "./models.js";
import { dialControl, powerIconUrl, powerState, stepChoice } from "./power.js";

const svg = (dataUrl: string) => Buffer.from(dataUrl.replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

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
		expect(svg(powerIconUrl(previewed.icon))).not.toBe(svg(powerIconUrl(state.current!.icon)));
		expect(svg(powerIconUrl(state.current!.icon))).toMatch(/^<svg[^>]*width="38" height="38"/);
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
});
