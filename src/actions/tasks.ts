import streamDeck, { type Action, action, type DialAction, type DidReceiveSettingsEvent, type KeyUpEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { t } from "../core/i18n.js";
import { COLORS, glyphArt, renderInfoKey, renderSkeletonKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { type ScheduledTask, type TaskState, taskView } from "../core/tasks.js";
import { deck } from "../deck.js";
import { connectionFace, DeckAction, pressWhileDisconnected } from "./base.js";
import { connectionOf } from "./needs.js";
import { type DialSettings, disconnectedStrip, StripDial } from "./strip.js";

const ID = "com.alejandrom2.t3deck";
const logger = streamDeck.logger.createScope("tasks");

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

const STATE_COLOR: Record<TaskState, string> = { running: COLORS.accent, failed: COLORS.error, on: COLORS.text, off: COLORS.muted };

const readyMachines = (url: string | undefined): Machine[] =>
	deck.machines.filter((machine) => machine.state.kind === "ready" && machine.environmentId !== undefined && (url === undefined || machine.url === url));

/**
 * Which machines visible task keys and dials read: their task lists stay live meanwhile, and a minute tick redraws
 * the "in 4m" times. Nothing runs while none shows.
 */
class TasksWatch {
	readonly #shown = new Map<string, string | undefined>();
	readonly #watched = new Map<string, () => void>();
	readonly #painters = new Set<() => void>();
	#tick: ReturnType<typeof setInterval> | undefined;

	show(id: string, url: string | undefined): void {
		this.#shown.set(id, url);
		this.sync();
	}

	hide(id: string): void {
		this.#shown.delete(id);
		this.sync();
	}

	onTick(paint: () => void): void {
		this.#painters.add(paint);
	}

	sync(): void {
		const urls = [...this.#shown.values()];
		const wanted = new Set(deck.machines.filter((machine) => urls.some((url) => url === undefined || url === machine.url)).map((machine) => machine.url));
		for (const [url, release] of this.#watched) {
			if (wanted.has(url)) continue;
			release();
			this.#watched.delete(url);
		}
		for (const machine of deck.machines) if (wanted.has(machine.url) && !this.#watched.has(machine.url)) this.#watched.set(machine.url, machine.watchTasks());
		if (this.#shown.size === 0) {
			clearInterval(this.#tick);
			this.#tick = undefined;
		} else this.#tick ??= setInterval(() => this.#painters.forEach((paint) => paint()), 60_000);
	}
}

const watch = new TasksWatch();
deck.onRepaint(() => watch.sync());

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

const nameOf = (entry: MachineTask, many: boolean) =>
	many && entry.machine.state.kind === "ready" ? `${entry.task.title} · ${entry.machine.state.label}` : entry.task.title;

/** Shared lifecycle: an instance shown keeps its machines' task lists live. */
abstract class TaskAction<T extends JsonObject & { machine?: string }> extends DeckAction<T> {
	override onWillAppear(ev: WillAppearEvent<T>): void {
		super.onWillAppear(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<T>): void {
		super.onDidReceiveSettings(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
	}

	override onWillDisappear(ev: WillDisappearEvent<T>): void {
		watch.hide(ev.action.id);
		super.onWillDisappear(ev);
	}
}

type RunTaskSettings = { machine?: string; task?: string; taskTitle?: string };

/** One scheduled task, picked in its settings: its name and when it runs next. Press runs it now. */
@action({ UUID: `${ID}.task` })
export class RunTaskKey extends TaskAction<RunTaskSettings> {
	constructor() {
		super();
		watch.onTick(() => this.#paintShown());
	}

	#paintShown(): void {
		for (const instance of this.actions) void this.paint(instance);
	}

	#state(action: Action<RunTaskSettings>) {
		const settings = this.settingsOf(action);
		const { tasks, loading, error } = machineTasks(this.machineOf(action));
		const entry = tasks.find((candidate) => candidate.key === settings.task);
		const name = settings.taskTitle?.trim() || settings.task?.slice(settings.task.indexOf("/") + 1) || "";
		const missing = !settings.task ? t("tasks.pickTask") : entry === undefined && !loading ? (error !== undefined ? t("tasks.updateT3") : t("tasks.gone", { task: name })) : undefined;
		if (entry !== undefined && entry.task.title !== settings.taskTitle) this.remember(action, { taskTitle: entry.task.title });
		return { entry, loading: entry === undefined && loading, missing };
	}

	override needs(action: Action<RunTaskSettings>): Need[] {
		const { entry, missing } = this.#state(action);
		const url = this.machineOf(action);
		return [
			{ kind: "paired", connection: connectionOf(url) },
			{ kind: "operate", ok: entry?.machine.canOperate ?? readyMachines(url).some((machine) => machine.canOperate) },
			{ kind: "value", value: entry?.task.title ?? (missing || t("tasks.pickTask")), ok: entry !== undefined },
		];
	}

	protected override async paint(action: Action<RunTaskSettings>): Promise<void> {
		if (!action.isKey()) return;
		const offline = connectionFace(this.machineOf(action));
		if (offline) return void (await this.setImage(action, offline));
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
				logger.warn(`Listing tasks failed: ${message(error)}`);
			}
		}
		const { task, taskTitle } = this.settingsOf(ev.action);
		if (task && !items.some((item) => item.value === task)) items.splice(1, 0, { label: t("tasks.gone", { task: taskTitle || task.slice(task.indexOf("/") + 1) }), value: task });
		await streamDeck.ui.sendToPropertyInspector({ event: "getTasks", items });
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

	constructor() {
		super();
		watch.onTick(() => {
			for (const instance of this.actions) void this.paint(instance);
		});
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
			{ kind: "operate", ok: readyMachines(url).some((machine) => machine.canOperate) },
			{ kind: "tasks", ok: tasks.length > 0 ? true : loading ? undefined : false },
		];
	}

	protected face(action: Action<TasksDialSettings>): StripContent {
		const header = t("tasks.title");
		const offline = disconnectedStrip(header, this.machineOf(action));
		if (offline) return offline;
		const { tasks, loading, error, index, entry, many } = this.#state(action);
		if (entry === undefined) {
			if (loading) return { header, icon: glyphArt("task", COLORS.muted), accent: COLORS.muted, value: t("tasks.loading"), loading: true };
			return { header, icon: glyphArt("task", COLORS.muted), accent: COLORS.muted, value: error !== undefined ? t("tasks.updateT3") : t("tasks.noTasks"), detail: error === undefined ? t("tasks.addInT3") : undefined };
		}
		const view = taskView(entry.task, Date.now());
		const color = STATE_COLOR[view.state];
		return {
			header: `${header} · ${index + 1}/${tasks.length}`,
			icon: glyphArt("task", color),
			accent: view.state === "off" ? COLORS.muted : view.state === "failed" ? COLORS.error : COLORS.accent,
			value: nameOf(entry, many),
			detail: entry.machine.canOperate ? view.when : `${view.when} · ${t("reason.readOnly")}`,
			detailColor: view.state === "failed" ? COLORS.error : undefined,
		};
	}

	protected override list(action: Action<TasksDialSettings>): StripList | undefined {
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
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

	override onWillAppear(ev: WillAppearEvent<TasksDialSettings>): void {
		super.onWillAppear(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<TasksDialSettings>): void {
		super.onDidReceiveSettings(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
	}

	override onWillDisappear(ev: WillDisappearEvent<TasksDialSettings>): void {
		watch.hide(ev.action.id);
		this.#shown.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}
