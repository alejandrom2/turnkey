import { describe, expect, it } from "vitest";

import { readTasks, type ScheduledTask, taskView } from "./tasks.js";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const task = (patch: Partial<ScheduledTask> = {}): ScheduledTask => ({ id: "t", title: "Nightly", enabled: true, schedule: { type: "interval" }, nextRunAt: null, lastRunStatus: "succeeded", ...patch });

describe("taskView", () => {
	it("says when an enabled task runs next, coarse like the deck's times", () => {
		expect(taskView(task({ nextRunAt: "2026-10-27T12:04:30.000Z" }), NOW)).toEqual({ state: "on", when: "in 4m" });
		expect(taskView(task({ nextRunAt: "2026-10-27T15:00:00.000Z" }), NOW).when).toBe("in 3h");
		expect(taskView(task({ nextRunAt: "2026-10-27T12:00:10.000Z" }), NOW).when).toBe("Now");
	});

	it("puts running and off before the schedule, and names webhook tasks", () => {
		expect(taskView(task({ lastRunStatus: "running", enabled: false }), NOW)).toEqual({ state: "running", when: "Running" });
		expect(taskView(task({ enabled: false, nextRunAt: "2026-10-27T13:00:00.000Z" }), NOW)).toEqual({ state: "off", when: "Off" });
		expect(taskView(task({ schedule: { type: "webhook" } }), NOW).when).toBe("On webhook");
	});

	it("flags a failed last run alongside the next one", () => {
		expect(taskView(task({ lastRunStatus: "failed", nextRunAt: "2026-10-27T12:30:00.000Z" }), NOW)).toEqual({ state: "failed", when: "Last run failed · in 30m" });
	});
});

describe("readTasks", () => {
	it("keeps the tasks it can read and skips shapes it can't", () => {
		expect(readTasks({ tasks: [task(), { id: 4 }, null] }).map((entry) => entry.id)).toEqual(["t"]);
		expect(readTasks(undefined)).toEqual([]);
	});
});
