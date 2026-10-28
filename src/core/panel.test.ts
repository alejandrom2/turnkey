import { describe, expect, it } from "vitest";

import { machineSummary, mergeGlobalSettings, needsFirstPairing } from "./panel.js";

const env = (state: string) => ({ state });

describe("machineSummary", () => {
	it("is green when every machine is connected", () => {
		expect(machineSummary([env("ready"), env("ready")])).toEqual({ tone: "ok", key: "inspector.card.connectedCount", params: { ready: 2, total: 2 } });
	});

	it("turns amber when one needs pairing or failed", () => {
		expect(machineSummary([env("ready"), env("ready"), env("signed-out")])).toMatchObject({ tone: "wait", params: { ready: 2, total: 3 } });
		expect(machineSummary([env("ready"), env("error")]).tone).toBe("wait");
	});

	it("stays gray while machines are still connecting", () => {
		expect(machineSummary([env("ready"), env("connecting")]).tone).toBe("muted");
	});

	it("says so when there are no machines", () => {
		expect(machineSummary([])).toEqual({ tone: "muted", key: "inspector.card.noMachines", params: {} });
	});
});

describe("needsFirstPairing", () => {
	it("asks for a pair link while nothing is paired", () => {
		expect(needsFirstPairing([])).toBe(true);
		expect(needsFirstPairing([env("signed-out")])).toBe(true);
	});

	it("stops once any machine is paired or connecting", () => {
		expect(needsFirstPairing([env("signed-out"), env("ready")])).toBe(false);
		expect(needsFirstPairing([env("connecting")])).toBe(false);
		expect(needsFirstPairing([env("error")])).toBe(false);
	});
});

describe("mergeGlobalSettings", () => {
	const current = { environments: "http://studio:3773", auth: { a: 1 }, scopeRequests: {}, verboseUntil: 5, motion: "full", idlePet: "off" };

	it("keeps every other setting and replaces only the edited one", () => {
		expect(mergeGlobalSettings(current, { motion: "reduced" })).toEqual({ ...current, motion: "reduced" });
	});

	it("never writes the plugin's own keys", () => {
		expect(mergeGlobalSettings(current, { auth: {}, environments: "", scopeRequests: { x: 1 }, verboseUntil: 9, stripStyle: "list" })).toEqual({
			...current,
			stripStyle: "list",
		});
	});

	it("starts from nothing when no settings were saved yet", () => {
		expect(mergeGlobalSettings(undefined, { scheme: "t3code-dev" })).toEqual({ scheme: "t3code-dev" });
	});
});
