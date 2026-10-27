import { describe, expect, it, vi } from "vitest";

import { findModel, type ModelConfig } from "./models.js";
import { effortChange, effortChoices } from "./power.js";
import { applyPromptEffortPrefix, offersUltrathink, UltrathinkArming, ultrathinkValues } from "./ultrathink.js";

const CONFIG: ModelConfig = {
	providers: [
		{
			instanceId: "claudeAgent",
			driver: "claudeAgent",
			models: [
				{
					slug: "opus",
					name: "Opus",
					capabilities: {
						optionDescriptors: [
							{
								id: "effort",
								label: "Effort",
								type: "select",
								options: [{ id: "low", label: "Low" }, { id: "high", label: "High", isDefault: true }, { id: "ultrathink", label: "Ultrathink" }],
								promptInjectedValues: ["ultrathink"],
							},
						],
					},
				},
				{ slug: "haiku", name: "Haiku" },
			],
		},
	],
};
const opus = findModel(CONFIG, { instanceId: "claudeAgent", model: "opus" });
const haiku = findModel(CONFIG, { instanceId: "claudeAgent", model: "haiku" });

describe("Ultrathink prefix", () => {
	it("prefixes like T3 Code: trimmed, never empty text, slash commands or text already prefixed", () => {
		expect(applyPromptEffortPrefix("  Fix it  ", "ultrathink")).toBe("Ultrathink:\nFix it");
		expect(applyPromptEffortPrefix("Fix it", "high")).toBe("Fix it");
		expect(applyPromptEffortPrefix("   ", "ultrathink")).toBe("");
		expect(applyPromptEffortPrefix("/review now", "ultrathink")).toBe("/review now");
		expect(applyPromptEffortPrefix("/a/b path", "ultrathink")).toBe("Ultrathink:\n/a/b path");
		expect(applyPromptEffortPrefix("Ultrathink: go", "ultrathink")).toBe("Ultrathink: go");
	});

	it("reads Ultrathink from the effort option's prompt-injected values", () => {
		expect(ultrathinkValues(opus)).toEqual([{ value: "ultrathink", label: "Ultrathink" }]);
		expect(offersUltrathink(opus)).toBe(true);
		expect(offersUltrathink(haiku)).toBe(false);
	});

	it("offers Ultrathink after the real efforts, arming it instead of sending an option", () => {
		expect(effortChoices(opus).map((choice) => [choice.label, choice.ultrathink])).toEqual([["Low", false], ["High", false], ["Ultrathink", true]]);
		expect(effortChange(opus, { instanceId: "claudeAgent", model: "opus" }, "ultrathink")).toEqual({ kind: "arm" });
		expect(effortChange(opus, { instanceId: "claudeAgent", model: "opus" }, "low")).toEqual({ kind: "set", optionId: "effort", value: "low", send: true });
		expect(effortChange(opus, { instanceId: "claudeAgent", model: "opus" }, "high")).toMatchObject({ kind: "set", send: false });
	});
});

describe("UltrathinkArming", () => {
	it("prefixes sends to an armed thread only, until disarmed", () => {
		const changed = vi.fn();
		const arming = new UltrathinkArming(changed);
		expect(arming.prompt("env/t1", opus, "Go")).toBe("Go");
		arming.arm("env/t1");
		arming.arm("env/t1");
		expect(changed).toHaveBeenCalledTimes(1);
		expect(arming.prompt("env/t1", opus, "Go")).toBe("Ultrathink:\nGo");
		expect(arming.prompt("env/t2", opus, "Go")).toBe("Go");
		arming.disarm("env/t1");
		expect(arming.prompt("env/t1", opus, "Go")).toBe("Go");
		expect(changed).toHaveBeenCalledTimes(2);
	});

	it("disarms when the thread's model no longer offers Ultrathink, but keeps it while the config is unknown", () => {
		const arming = new UltrathinkArming();
		arming.arm("env/t1");
		expect(arming.armed("env/t1", undefined)).toBe(true);
		expect(arming.armed("env/t1", haiku)).toBe(false);
		expect(arming.armed("env/t1", opus)).toBe(false);
	});
});
