import streamDeck, { type Action, action, type DialAction, type KeyUpEvent, type SendToPluginEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { t } from "../core/i18n.js";
import { COLORS, glyphArt, renderInfoKey, renderSkeletonKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { type ScheduledTask, type TaskState, taskView } from "../core/tasks.js";
import { deck } from "../deck.js";
import { canOperate, DeckAction, errorMessage, machineName, pressWhileDisconnected, readyMachines, sendChoices } from "./base.js";
import { connectionOf } from "./needs.js";
import { type DialSettings, StripDial } from "./strip.js";
import { DeckWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";
const logger = streamDeck.logger.createScope("tasks");

const STATE_COLOR: Record<TaskState, string> = { running: COLORS.accent, failed: COLORS.error, on: COLORS.text, off: COLORS.muted };

/** The task lists of the machines visible task keys and dials show stay live; a minute tick redraws the "in 4m" times. */
const watch = new DeckWatch({ open: (machine) => machine.watchTasks() });

/** A task with the machine it runs on, keyed `${environmentId}/${taskId}` like a thread. */
type MachineTask = { key: string; task: ScheduledTask; machine: Machine };

/** Every listed task on the machines `url` names (or all), and whether any machine is still listing or can't. */
function machineTasks(url: string | undefined): { tasks: MachineTask[]; loading: boolean; error: string | undefined } {
	const tasks: MachineTask[] = [];
	let loading = false;
	let error: string | undefined;
	for (const machine of readyMachines(url)) {
		if (machine.tasksError !== undefined) error = machine.tasksError;
		else if (machine.tasks === undefined) loading = true;
		for (const task of machine.tasks ?? []) tasks.push({ key: `${machine.environmentId}/${task.id}`, task, machine });
	}
	return { tasks, loading, error };
}

const nameOf = (entry: MachineTask, many: boolean) => (many ? `${entry.task.title} · ${machineName(entry.machine)}` : entry.task.title);

type RunTaskSettings = { machine?: string; task?: string; taskTitle?: string };

/** One scheduled task, picked in its settings: its name and when it runs next. Press runs it now. */
@action({ UUID: `${ID}.task` })
export class RunTaskKey extends DeckAction<RunTaskSettings> {
	protected override readonly watcher = watch;

	constructor() {
		super();
		watch.onTick(() => this.repaintAll());
	}

	#state(action: Action<RunTaskSettings>) {
		const settings = this.settingsOf(action);
		const url = this.machineOf(action);
		const key = settings.task ?? "";
		const environmentId = key.slice(0, key.indexOf("/"));
		// The task's own machine decides: offline or still listing, it may well be there.
		const owner = deck.machines.find((machine) => machine.environmentId === environmentId && (url === undefined || machine.url === url));
		const listed = owner?.state.kind === "ready" ? owner.tasks : undefined;
		const entry = listed?.map((task): MachineTask => ({ key: `${environmentId}/${task.id}`, task, machine: owner! })).find((candidate) => candidate.key === key);
		const loading = key !== "" && entry === undefined && owner !== undefined && listed === undefined && owner.tasksError === undefined;
		const name = settings.taskTitle?.trim() || key.slice(key.indexOf("/") + 1);
		const missing = !key ? t("tasks.pickTask") : entry === undefined && !loading ? (owner?.tasksError !== undefined ? t("tasks.updateT3") : t("tasks.gone", { task: name })) : undefined;
		if (entry !== undefined && entry.task.title !== settings.taskTitle) this.remember(action, { taskTitle: entry.task.title });
		return { entry, loading, missing };
	}

	override needs(action: Action<RunTaskSettings>): Need[] {
		const { entry, missing } = this.#state(action);
		const url = this.machineOf(action);
		return [
			{ kind: "paired", connection: connectionOf(url) },
			{ kind: "operate", ok: entry?.machine.canOperate ?? canOperate(undefined, url) },
			{ kind: "value", value: entry?.task.title ?? (missing || t("tasks.pickTask")), ok: entry !== undefined },
		];
	}

	protected override async draw(action: Action<RunTaskSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { entry, loading, missing } = this.#state(action);
		if (loading) return void (await this.setImage(action, renderSkeletonKey()));
		if (entry === undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "task", title: missing ?? t("tasks.pickTask"), available: false })));
		const view = taskView(entry.task, Date.now());
		await this.setImage(action, renderInfoKey({ glyph: "task", color: STATE_COLOR[view.state], title: entry.task.title, detail: view.when, available: entry.machine.canOperate }));
	}

	override async onKeyUp(ev: KeyUpEvent<RunTaskSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { entry, missing } = this.#state(ev.action);
		if (entry === undefined) return void (await this.flash(ev.action, false, missing ?? t("result.loading")));
		if (!entry.machine.canOperate) return void (await this.flash(ev.action, false, t("reason.readOnly")));
		await this.run(ev.action, () => entry.machine.runTask(entry.task.id));
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, RunTaskSettings>): Promise<void> {
		if ((ev.payload as { event?: string } | null)?.event !== "getTasks") return super.onSendToPlugin(ev);
		const machines = readyMachines(this.machineOf(ev.action));
		const items = [{ label: t("tasks.chooseTask"), value: "" }];
		for (const machine of machines) {
			try {
				for (const task of await machine.listTasks()) {
					items.push({ label: nameOf({ key: "", task, machine }, machines.length > 1), value: `${machine.environmentId}/${task.id}` });
				}
			} catch (error) {
				logger.warn(`Listing tasks failed: ${errorMessage(error)}`);
			}
		}
		const { task, taskTitle } = this.settingsOf(ev.action);
		await sendChoices("getTasks", items, task, (saved) => t("tasks.gone", { task: taskTitle || saved.slice(saved.indexOf("/") + 1) }));
	}
}

type TasksDialSettings = DialSettings;

/**
 * The machine's scheduled tasks: name, when each runs next and whether it is on. Rotate picks one, press runs it now,
 * tap turns it off or back on.
 */
@action({ UUID: `${ID}.dial.tasks` })
export class TasksDial extends StripDial<TasksDialSettings> {
	/** The task each dial shows, by key, so it stays put as the list changes. */
	readonly #shown = new Map<string, string>();
	protected override readonly watcher = watch;

	constructor() {
		super();
		watch.onTick(() => this.repaintAll());
	}

	#state(action: Action<TasksDialSettings>) {
		const listed = machineTasks(this.machineOf(action));
		const index = Math.max(
			0,
			listed.tasks.findIndex((entry) => entry.key === this.#shown.get(action.id)),
		);
		return { ...listed, index, entry: listed.tasks[index] as MachineTask | undefined, many: readyMachines(this.machineOf(action)).length > 1 };
	}

	override needs(action: Action<TasksDialSettings>): Need[] {
		const { tasks, loading } = this.#state(action);
		const url = this.machineOf(action);
		return [
			{ kind: "paired", connection: connectionOf(url) },
			{ kind: "operate", ok: canOperate(undefined, url) },
			{ kind: "tasks", ok: tasks.length > 0 ? true : loading ? undefined : false },
		];
	}

	protected heading(): string {
		return t("tasks.title");
	}

	protected face(action: Action<TasksDialSettings>): StripContent {
		const header = this.heading();
		const { tasks, loading, error, index, entry, many } = this.#state(action);
		if (entry === undefined) {
			if (loading) return { header, icon: glyphArt("task", COLORS.muted), value: t("tasks.loading"), loading: true };
			return { header, icon: glyphArt("task", COLORS.muted), value: error !== undefined ? t("tasks.updateT3") : t("tasks.noTasks"), detail: error === undefined ? t("tasks.addInT3") : undefined };
		}
		const view = taskView(entry.task, Date.now());
		const color = STATE_COLOR[view.state];
		return {
			header: `${header} · ${index + 1}/${tasks.length}`,
			icon: glyphArt("task", color),
			value: nameOf(entry, many),
			detail: entry.machine.canOperate ? view.when : `${view.when} · ${t("reason.readOnly")}`,
			detailColor: view.state === "failed" ? COLORS.error : undefined,
		};
	}

	protected override list(action: Action<TasksDialSettings>): StripList | undefined {
		const { tasks, index, entry, many } = this.#state(action);
		if (entry === undefined) return undefined;
		const now = Date.now();
		return {
			heading: t("tasks.title"),
			index,
			items: tasks.map((candidate) => {
				const view = taskView(candidate.task, now);
				return { key: candidate.key, label: nameOf(candidate, many), art: glyphArt("task", STATE_COLOR[view.state]), detail: candidate === entry ? view.when : undefined };
			}),
			note: { text: `${taskView(entry.task, now).when} · ${t(entry.task.enabled ? "tasks.pressToRun" : "tasks.pressToRunOff")}` },
		};
	}

	protected override rotated(dial: DialAction<TasksDialSettings>, ticks: number): void {
		const { tasks, index } = this.#state(dial);
		const next = tasks[Math.min(tasks.length - 1, Math.max(0, index + ticks))];
		if (next !== undefined) this.#shown.set(dial.id, next.key);
	}

	/** Runs `work` on the shown task, once its machine may act. */
	async #act(dial: DialAction<TasksDialSettings>, work: (entry: MachineTask) => Promise<void>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		const { entry, loading } = this.#state(dial);
		if (entry === undefined) return void (await this.flash(dial, false, loading ? t("result.loading") : t("tasks.noTasks")));
		if (!entry.machine.canOperate) return void (await this.flash(dial, false, t("reason.readOnly")));
		await this.run(dial, () => work(entry));
	}

	protected override pressed(dial: DialAction<TasksDialSettings>): Promise<void> {
		return this.#act(dial, (entry) => entry.machine.runTask(entry.task.id));
	}

	/** Turning a task off is undone by the same tap, so it needs no hold. */
	protected override tapped(dial: DialAction<TasksDialSettings>): Promise<void> {
		return this.#act(dial, (entry) => entry.machine.setTaskEnabled(entry.task.id, !entry.task.enabled));
	}

	override onWillDisappear(ev: WillDisappearEvent<TasksDialSettings>): void {
		this.#shown.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}
