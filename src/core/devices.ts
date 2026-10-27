/**
 * T3 Code's device hub: simulators and emulators on the machine and its device hosts (packages/contracts/src/device.ts),
 * worded as its Device panel words them (apps/web/src/components/device/DevicePanel.tsx).
 */

export type DevicePlatform = "ios" | "android";

/** A `DeviceSummary`. */
export type Device = { hostId: string; id: string; platform: DevicePlatform; name: string; version: string; booted: boolean; physical: boolean };

type DeviceHost = { id: string; label: string; kind: string };
type HostStatus = "disabled" | "idle" | "installing" | "starting" | "ready" | "failed";

/** A `DeviceServiceState` as it arrives: EAS hosts travel apart from the others (`easHosts`) for older clients. */
export type DeviceState = {
	hostStatus: HostStatus;
	hostStatusDetail?: string;
	hostStatuses: Record<string, { status: HostStatus; detail?: string }>;
	hosts: DeviceHost[];
	devices: Device[];
	sessions: { threadId: string; hostId: string; deviceId: string }[];
	bootingDevices?: (Device & { threadId: string })[];
	onboardingCompleted: boolean;
	revision: number;
};

/** Reads a state from the wire, folding EAS hosts in with the rest as T3 Code's own decoding does. */
export function readDeviceState(value: unknown): DeviceState | undefined {
	const raw = value as Partial<DeviceState> & { easHosts?: DeviceHost[] } | null;
	if (raw === null || typeof raw !== "object" || !Array.isArray(raw.devices) || typeof raw.hostStatus !== "string") return undefined;
	return {
		hostStatus: raw.hostStatus,
		hostStatusDetail: raw.hostStatusDetail,
		hostStatuses: raw.hostStatuses ?? {},
		hosts: [...(raw.hosts ?? []), ...(raw.easHosts ?? [])],
		devices: raw.devices,
		sessions: raw.sessions ?? [],
		bootingDevices: raw.bootingDevices,
		onboardingCompleted: raw.onboardingCompleted === true,
		revision: raw.revision ?? 0,
	};
}

/** Why the hub has no devices to offer, if it doesn't: turned off, still starting, or failed. */
export type HubProblem = { kind: "off" } | { kind: "starting" } | { kind: "failed"; detail?: string };

/** `deviceHubReadiness`: any ready host makes the hub ready; otherwise it is starting, failed or off. */
export function hubProblem(state: DeviceState): HubProblem | undefined {
	if (!state.onboardingCompleted || state.hostStatus === "disabled") return { kind: "off" };
	const statuses = Object.values(state.hostStatuses).map((host) => host.status);
	if (state.hostStatus === "ready" || statuses.includes("ready")) return undefined;
	if ([state.hostStatus, ...statuses].some((status) => status === "installing" || status === "starting")) return { kind: "starting" };
	if (state.hostStatus === "failed") return { kind: "failed", detail: state.hostStatusDetail };
	return undefined;
}

/** What a device is doing, for one thread: starting, open in that thread, running, or stopped. */
export type DeviceStatus = "starting" | "open" | "running" | "stopped";

export type DeviceRow = { key: string; device: Device; host: string; cloud: boolean; status: DeviceStatus };

const same = (device: Pick<Device, "hostId" | "id">, hostId: string, id: string) => device.hostId === hostId && device.id === id;

/**
 * The devices to browse, for `threadId`: running ones first, then by platform and name. A cloud (EAS) device bills
 * its Expo account while it runs, so it is marked.
 */
export function deviceRows(state: DeviceState, threadId: string | undefined): DeviceRow[] {
	const rows = state.devices.map((device): DeviceRow => {
		const host = state.hosts.find((candidate) => candidate.id === device.hostId);
		const status: DeviceStatus = state.bootingDevices?.some((booting) => same(booting, device.hostId, device.id))
			? "starting"
			: state.sessions.some((session) => session.threadId === threadId && same({ hostId: session.hostId, id: session.deviceId }, device.hostId, device.id))
				? "open"
				: device.booted
					? "running"
					: "stopped";
		return { key: `${device.hostId}\u0000${device.id}`, device, host: host?.label ?? device.hostId, cloud: host?.kind === "eas", status };
	});
	const rank = (row: DeviceRow) => (row.status === "stopped" ? 1 : 0);
	return rows.sort((a, b) => rank(a) - rank(b) || a.device.platform.localeCompare(b.device.platform) || a.device.name.localeCompare(b.device.name));
}

/** What a press does to a device: start or open it in the thread, power it off, or why it can't. */
export type DevicePress = { kind: "open" } | { kind: "powerOff" } | { kind: "refuse"; reason: "holdToStartCloud" | "physical" | "starting" };

/**
 * A short press starts a stopped device (a cloud one needs a hold: it bills) or opens a running one in the thread; a
 * hold powers a running simulator or emulator off. A real device can't be powered off from here.
 */
export function devicePress(row: DeviceRow, held: boolean): DevicePress {
	if (row.status === "starting") return { kind: "refuse", reason: "starting" };
	if (row.status === "stopped") return row.cloud && !held ? { kind: "refuse", reason: "holdToStartCloud" } : { kind: "open" };
	if (!held) return { kind: "open" };
	return row.device.physical ? { kind: "refuse", reason: "physical" } : { kind: "powerOff" };
}
