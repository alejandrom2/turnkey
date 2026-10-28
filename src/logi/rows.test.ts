import { describe, expect, it } from "vitest";

import { t } from "../core/i18n.js";
import { keptMachines, machineRows } from "./rows.js";

const none = () => undefined;

describe("machineRows", () => {
	it("names a ready machine as it calls itself", () => {
		const [row] = machineRows([{ url: "https://studio.example", state: { kind: "ready", environmentId: "e", label: "Studio", canOperate: true } }], none);
		expect(row).toMatchObject({ state: "connected", label: "Studio" });
	});

	it("says why a pairing broke", () => {
		const [row] = machineRows([{ url: "https://studio.example", state: { kind: "signed-out", message: "Revoked" } }], () => "Studio");
		expect(row).toMatchObject({ state: "problem", detail: "Revoked" });
	});

	it("asks this computer to pair", () => {
		const [row] = machineRows([{ url: "http://127.0.0.1:3773", state: { kind: "signed-out" } }], none);
		expect(row).toMatchObject({ label: t("machine.thisMachine"), state: "needsPairing" });
	});

	it("names another machine by its pairing, else its host", () => {
		const machine = { url: "http://laptop:3773", state: { kind: "connecting" } } as const;
		expect(machineRows([machine], () => "Laptop")[0]).toMatchObject({ label: "Laptop", state: "connecting" });
		expect(machineRows([machine], none)[0]?.label).toBe("laptop:3773");
	});
});

describe("keptMachines", () => {
	it("keeps a remote machine whose pairing expired", () => {
		expect(keptMachines(["https://a.example"], ["https://a.example", "https://b.example"], new Set())).toEqual(["https://a.example", "https://b.example"]);
	});

	it("drops a removed machine", () => {
		expect(keptMachines([], ["https://b.example"], new Set(["https://b.example"]))).toEqual([]);
	});

	it("keeps this computer only while stored or found", () => {
		expect(keptMachines([], ["http://127.0.0.1:3773"], new Set())).toEqual([]);
		expect(keptMachines(["http://127.0.0.1:3773"], ["http://127.0.0.1:3773"], new Set())).toEqual(["http://127.0.0.1:3773"]);
	});
});
