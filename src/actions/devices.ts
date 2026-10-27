import { type Action, action, type DialAction, type WillDisappearEvent } from "@elgato/streamdeck";

import type { DeckThread } from "../core/board.js";
import { type DevicePress, devicePress, type DeviceRow, deviceRows, type DeviceState, type DeviceStatus, hubProblem, readDeviceState } from "../core/devices.js";
import { type MessageKey, t } from "../core/i18n.js";
import { COLORS, glyphArt } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { OPERATE_SCOPE } from "../core/t3/pairing.js";
import { pinnedName } from "../core/target.js";
import { deck } from "../deck.js";
import { held, pressWhileDisconnected, readyMachines } from "./base.js";
import { threadNeeds } from "./needs.js";
import { type DialSettings, StripDial } from "./strip.js";
import { MachineWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";

type DevicesDialSettings = DialSettings & { target?: string; thread?: string; threadTitle?: string };

const STATUS: Record<DeviceStatus, { key: MessageKey; color: string }> = {
	open: { key: "devices.open", color: COLORS.accent },
	running: { key: "devices.running", color: COLORS.accent },
	starting: { key: "devices.starting", color: COLORS.accent },
	stopped: { key: "devices.stopped", color: COLORS.muted },
};

const REFUSAL: Record<Extract<DevicePress, { kind: "refuse" }>["reason"], MessageKey> = {
	holdToStartCloud: "devices.holdToStartCloud",
	physical: "devices.physical",
	starting: "devices.starting",
};

const platformName = (row: DeviceRow) => t(row.device.platform === "ios" ? "devices.ios" : "devices.android");

/**
 * Each machine's device hub while a Devices dial shows it: its state streams meanwhile, and its devices are listed
 * once per connection (which, as T3 Code's Device panel does, starts the hub when devices are turned on there).
 */
class DeviceHubs {
	readonly #states = new Map<string, DeviceState>();
	/** Machines whose devices couldn't be read (an older T3 Code, a hub error) since their last state. */
	readonly #failed = new Set<string>();
	/** Only the hubs of the machines visible dials show are watched (and listing may start one). */
	readonly watch = new MachineWatch({
		// A new connection may be a restarted T3 Code, whose revisions start over: drop the old state first.
		open: (machine) =>
			machine.live(
				"subscribeDeviceState",
				{},
				(value) => this.#set(machine, value),
				() => {
					this.#forget(machine);
					void this.list(machine).catch(() => undefined);
				},
			),
		closed: (machine) => this.#forget(machine),
	});

	of(machine: Machine): DeviceState | undefined {
		return this.#states.get(machine.url);
	}

	failed(machine: Machine): boolean {
		return this.#failed.has(machine.url);
	}

	/** Asks the machine to look for devices again (`device.list`), as T3 Code's Device panel does when it opens. */
	async list(machine: Machine): Promise<void> {
		try {
			this.#set(machine, await machine.call("device.list", {}));
		} catch (error) {
			this.#failed.add(machine.url);
			deck.repaint();
			throw error;
		}
	}

	#forget(machine: Machine): void {
		this.#states.delete(machine.url);
		this.#failed.delete(machine.url);
	}

	#set(machine: Machine, value: unknown): void {
		const state = readDeviceState(value);
		if (state === undefined || (this.#states.get(machine.url)?.revision ?? -1) > state.revision) return;
		this.#states.set(machine.url, state);
		this.#failed.delete(machine.url);
		deck.repaint();
	}
}

const hubs = new DeviceHubs();

/**
 * T3 Code's simulators and emulators: name, platform and whether each runs. Rotate picks one; press starts it, or
 * opens a running one, in the target thread's Device panel; hold powers it off. Touch looks for devices again.
 */
@action({ UUID: `${ID}.dial.devices` })
export class DevicesDial extends StripDial<DevicesDialSettings> {
	/** The device each dial shows, by key, so it stays put as the list changes. */
	readonly #shown = new Map<string, string>();
	protected override readonly watcher = hubs.watch;

	/** The machine whose devices the dial shows: its target thread's, else the first ready one it follows. */
	#machine(action: Action<DevicesDialSettings>, thread: DeckThread | undefined = this.target(action).thread): Machine | undefined {
		return thread?.machine ?? readyMachines(this.machineOf(action))[0];
	}

	protected override watched(action: Action<DevicesDialSettings>): readonly Machine[] {
		return [this.#machine(action)].filter((machine) => machine !== undefined);
	}

	protected heading(): string {
		return t("devices.title");
	}

	#state(action: Action<DevicesDialSettings>) {
		const { thread, gone, pinned } = this.target(action);
		const machine = this.#machine(action, thread);
		const hub = machine && hubs.of(machine);
		const rows = hub === undefined ? [] : deviceRows(hub, thread?.threadId);
		const index = Math.max(
			0,
			rows.findIndex((row) => row.key === this.#shown.get(action.id)),
		);
		return { thread, gone, pinned, machine, hub, problem: hub && hubProblem(hub), rows, index, row: rows[index] as DeviceRow | undefined };
	}

	override needs(action: Action<DevicesDialSettings>): Need[] {
		const { thread, machine, hub, problem, rows } = this.#state(action);
		const target = this.target(action);
		const failed = machine !== undefined && hubs.failed(machine);
		return [
			...threadNeeds(this.machineOf(action), thread, true, target.pinned ? pinnedName(this.settingsOf(action)) : undefined),
			{ kind: "devices", ok: hub === undefined ? (failed ? false : undefined) : problem === undefined && rows.length > 0 },
		];
	}

	protected face(action: Action<DevicesDialSettings>): StripContent {
		const header = this.heading();
		const { thread, gone, machine, hub, problem, rows, index, row } = this.#state(action);
		const muted = (value: string, detail?: string, color: string = COLORS.muted): StripContent => ({ header, icon: glyphArt("device", color), accent: color, value, detail });
		if (hub === undefined && machine !== undefined && hubs.failed(machine)) return muted(t("devices.unreadable"), t("devices.touchToCheck"));
		if (hub === undefined) return { ...muted(t("devices.loading")), loading: true };
		if (problem?.kind === "off") return muted(t("devices.off"), t("devices.turnOn"));
		if (problem?.kind === "starting") return { ...muted(t("devices.hubStarting")), loading: true };
		if (problem?.kind === "failed") return muted(t("devices.hubFailed"), problem.detail, COLORS.error);
		if (row === undefined) return muted(t("devices.none"), t("devices.touchToCheck"));
		const status = STATUS[row.status];
		const where = thread === undefined ? (gone ?? t("reason.noThread")) : undefined;
		return {
			header: `${header} · ${index + 1}/${rows.length}`,
			icon: glyphArt("device", status.color),
			accent: status.color,
			value: row.device.name,
			detail: [platformName(row), row.device.version, t(status.key), row.cloud ? row.host : undefined, where].filter(Boolean).join(" · "),
			loading: row.status === "starting",
		};
	}

	protected override list(action: Action<DevicesDialSettings>): StripList | undefined {
		const { rows, index, row, problem } = this.#state(action);
		if (row === undefined || problem !== undefined) return undefined;
		return {
			heading: t("devices.title"),
			index,
			items: rows.map((candidate) => ({
				key: candidate.key,
				label: candidate.device.name,
				art: glyphArt("device", STATUS[candidate.status].color),
				detail: candidate === row ? `${platformName(candidate)} · ${t(STATUS[candidate.status].key)}` : undefined,
			})),
			note: { text: t(row.status === "stopped" ? "devices.pressToStart" : "devices.pressToOpen") },
		};
	}

	protected override rotated(dial: DialAction<DevicesDialSettings>, ticks: number): void {
		const { rows, index } = this.#state(dial);
		const next = rows[Math.min(rows.length - 1, Math.max(0, index + ticks))];
		if (next !== undefined) this.#shown.set(dial.id, next.key);
	}

	protected override async pressed(dial: DialAction<DevicesDialSettings>, heldMs: number): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		const { thread, gone, machine, hub, problem, row } = this.#state(dial);
		if (hub === undefined || machine === undefined) return void (await this.flash(dial, false, t("result.loading")));
		if (problem !== undefined) return void (await this.flash(dial, false, t(problem.kind === "off" ? "devices.off" : problem.kind === "starting" ? "devices.hubStarting" : "devices.hubFailed")));
		if (row === undefined) return void (await this.flash(dial, false, t("devices.none")));
		if (!machine.canOperate) return void (await this.flash(dial, false, t("reason.readOnly")));
		const press = devicePress(row, held(heldMs));
		if (press.kind === "refuse") return void (await this.flash(dial, false, t(REFUSAL[press.reason])));
		const { hostId, id: deviceId, platform } = row.device;
		if (press.kind === "powerOff") return this.run(dial, () => machine.call("device.shutdown", { hostId, deviceId, platform }, OPERATE_SCOPE));
		// T3 Code starts a device in a thread's Device panel, from that thread's checkout.
		if (thread === undefined) return void (await this.flash(dial, false, gone ?? t("reason.noThread")));
		await this.run(dial, () => openDevice(thread, row));
	}

	/** Looking again is cheap to undo and reads only: no hold. */
	protected override async tapped(dial: DialAction<DevicesDialSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		const { machine } = this.#state(dial);
		if (machine === undefined) return;
		await this.run(dial, () => hubs.list(machine));
	}

	override onWillDisappear(ev: WillDisappearEvent<DevicesDialSettings>): void {
		this.#shown.delete(ev.action.id);
		super.onWillDisappear(ev);
	}
}

const openDevice = (thread: DeckThread, row: DeviceRow) =>
	thread.machine.call("device.open", { threadId: thread.threadId, hostId: row.device.hostId, deviceId: row.device.id, platform: row.device.platform }, OPERATE_SCOPE);
