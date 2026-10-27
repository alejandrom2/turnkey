import { describe, expect, it } from "vitest";

import { type Device, devicePress, deviceRows, type DeviceState, hubProblem, readDeviceState } from "./devices.js";

const device = (id: string, patch: Partial<Device> = {}): Device => ({ hostId: "local", id, platform: "ios", name: id, version: "18.0", booted: false, physical: false, ...patch });

const state = (patch: Partial<DeviceState> = {}): DeviceState => ({
	hostStatus: "ready",
	hostStatuses: { local: { status: "ready" } },
	hosts: [{ id: "local", label: "This machine", kind: "local" }],
	devices: [],
	sessions: [],
	onboardingCompleted: true,
	revision: 1,
	...patch,
});

describe("readDeviceState", () => {
	it("folds EAS hosts in with the others and rejects what isn't a state", () => {
		const read = readDeviceState({ ...state(), easHosts: [{ id: "eas", label: "EAS", kind: "eas" }] });
		expect(read?.hosts.map((host) => host.id)).toEqual(["local", "eas"]);
		expect(readDeviceState(null)).toBeUndefined();
		expect(readDeviceState({ devices: "no" })).toBeUndefined();
	});
});

describe("hubProblem", () => {
	it("is off until set up and turned on, starting while it installs, and fine once any host is ready", () => {
		expect(hubProblem(state({ onboardingCompleted: false }))).toEqual({ kind: "off" });
		expect(hubProblem(state({ hostStatus: "disabled" }))).toEqual({ kind: "off" });
		expect(hubProblem(state({ hostStatus: "starting", hostStatuses: {} }))).toEqual({ kind: "starting" });
		expect(hubProblem(state({ hostStatus: "failed", hostStatusDetail: "No Xcode", hostStatuses: {} }))).toEqual({ kind: "failed", detail: "No Xcode" });
		expect(hubProblem(state({ hostStatus: "failed", hostStatuses: { ssh: { status: "ready" } } }))).toBeUndefined();
	});
});

describe("deviceRows", () => {
	it("lists running devices first, open ones for this thread only, and marks cloud ones", () => {
		const rows = deviceRows(
			state({
				hosts: [
					{ id: "local", label: "This machine", kind: "local" },
					{ id: "eas", label: "EAS", kind: "eas" },
				],
				devices: [device("b-stopped"), device("a-running", { booted: true }), device("pixel", { platform: "android", booted: true }), device("cloud", { hostId: "eas" }), device("c-booting")],
				sessions: [{ threadId: "t-1", hostId: "local", deviceId: "pixel" }],
				bootingDevices: [{ ...device("c-booting"), threadId: "t-2" }],
			}),
			"t-1",
		);
		expect(rows.map((row) => [row.device.id, row.status, row.cloud])).toEqual([
			["pixel", "open", false],
			["a-running", "running", false],
			["c-booting", "starting", false],
			["b-stopped", "stopped", false],
			["cloud", "stopped", true],
		]);
		expect(deviceRows(state({ devices: [device("pixel", { booted: true })], sessions: [{ threadId: "t-1", hostId: "local", deviceId: "pixel" }] }), "t-9")[0]?.status).toBe("running");
	});
});

describe("devicePress", () => {
	const row = (patch: Partial<Device>, status: "starting" | "open" | "running" | "stopped", cloud = false) => ({ key: "k", device: device("d", patch), host: "This machine", cloud, status });

	it("starts or opens on a press, powers off on a hold, and holds back cloud starts and real devices", () => {
		expect(devicePress(row({}, "stopped"), false)).toEqual({ kind: "open" });
		expect(devicePress(row({}, "stopped"), true)).toEqual({ kind: "open" });
		expect(devicePress(row({}, "stopped", true), false)).toEqual({ kind: "refuse", reason: "holdToStartCloud" });
		expect(devicePress(row({}, "stopped", true), true)).toEqual({ kind: "open" });
		expect(devicePress(row({ booted: true }, "running"), false)).toEqual({ kind: "open" });
		expect(devicePress(row({ booted: true }, "open"), true)).toEqual({ kind: "powerOff" });
		expect(devicePress(row({ booted: true, physical: true }, "running"), true)).toEqual({ kind: "refuse", reason: "physical" });
		expect(devicePress(row({}, "starting"), false)).toEqual({ kind: "refuse", reason: "starting" });
	});
});
