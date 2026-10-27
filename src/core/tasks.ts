import { elapsed, t } from "./i18n.js";

/** The `ScheduledTask` fields the deck reads (packages/contracts/src/scheduledTask.ts). */
export type ScheduledTask = {
	id: string;
	title: string;
	enabled: boolean;
	schedule?: { type?: string };
	nextRunAt?: string | null;
	lastRunStatus?: "never" | "running" | "succeeded" | "failed" | string;
	lastRunError?: string | null;
};

/** The tasks of a `scheduledTasks.*` reply; entries a newer server adds in other shapes are skipped. */
export function readTasks(value: unknown): ScheduledTask[] {
	const tasks = (value as { tasks?: unknown } | null)?.tasks;
	if (!Array.isArray(tasks)) return [];
	return tasks.filter(
		(task): task is ScheduledTask =>
			task !== null && typeof task === "object" && typeof (task as ScheduledTask).id === "string" && typeof (task as ScheduledTask).title === "string" && typeof (task as ScheduledTask).enabled === "boolean",
	);
}

export type TaskState = "running" | "failed" | "on" | "off";

/** A task in a line: running, off, when it runs next, or that a webhook starts it. */
export type TaskView = { state: TaskState; when: string };

/** How soon `at` is, coarse like the deck's elapsed times: "in 4m", "in 1.5h", "in 2d"; "now" once due. */
export function untilLabel(at: number, now: number): string {
	return at <= now + 30_000 ? t("tasks.now") : t("tasks.in", { time: elapsed(now, at) });
}

export function taskView(task: ScheduledTask, now: number): TaskView {
	if (task.lastRunStatus === "running") return { state: "running", when: t("tasks.running") };
	if (!task.enabled) return { state: "off", when: t("tasks.off") };
	const failed = task.lastRunStatus === "failed";
	const next = task.nextRunAt ? Date.parse(task.nextRunAt) : Number.NaN;
	const when = !Number.isNaN(next) ? untilLabel(next, now) : task.schedule?.type === "webhook" ? t("tasks.onWebhook") : t("tasks.notScheduled");
	return { state: failed ? "failed" : "on", when: failed ? t("tasks.lastFailed", { when }) : when };
}
