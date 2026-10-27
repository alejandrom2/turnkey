import { describe, expect, it } from "vitest";

import { canStopWorkflows, runningWorkflows, stopWorkflowFailure } from "./workflows.js";

const workflow = (id: string, patch: Record<string, unknown> = {}) => ({ id, origin: "provider_native", driver: "claudeAgent", status: "running", title: "Coordinator", workflow: { name: `wf ${id}` }, ...patch });

describe("runningWorkflows", () => {
	it("offers only what T3 Code's Lineage panel lets a user stop: running provider-native Claude workflows", () => {
		const subagents = [
			workflow("a"),
			workflow("b", { status: "completed" }),
			workflow("c", { origin: "app_owned" }),
			workflow("d", { driver: "codex" }),
			workflow("e", { workflow: undefined }),
			workflow("f", { workflow: {} }),
		];
		expect(runningWorkflows({ subagents })).toEqual([
			{ id: "a", name: "wf a" },
			{ id: "f", name: "Coordinator" },
		]);
		expect(runningWorkflows(undefined)).toEqual([]);
	});

	it("is offered on Claude only", () => {
		expect(canStopWorkflows("claudeAgent")).toBe(true);
		expect(canStopWorkflows("codex")).toBe(false);
	});

	it("words T3 Code's refusals, and leaves unknown ones to the generic failure", () => {
		expect(stopWorkflowFailure("not-running")).toBe("No longer running");
		expect(stopWorkflowFailure("later")).toBeUndefined();
		expect(stopWorkflowFailure(undefined)).toBeUndefined();
	});
});
