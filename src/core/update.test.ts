import { describe, expect, it } from "vitest";

import { compareVersions, releaseChannel, updateFailure, updateRoute, updateTarget } from "./update.js";

const TAGS = { latest: "0.1.3", nightly: "0.1.4-nightly.20261027.3783", preview: "0.1.3-preview.20261026.3702" };

describe("update route", () => {
	it("follows the server's self-update capability", () => {
		expect(updateRoute({ capabilities: { serverSelfUpdate: "boot-service", serverSelfUpdateProgress: true } })).toEqual({ kind: "service", progress: true });
		expect(updateRoute({ capabilities: { serverSelfUpdate: "respawn" } })).toEqual({ kind: "service", progress: false });
		expect(updateRoute({ capabilities: { serverSelfUpdate: "desktop-managed", desktopAppUpdate: true } })).toEqual({ kind: "desktop", progress: false });
		expect(updateRoute({ capabilities: { serverSelfUpdate: "desktop-managed" } })).toEqual({ kind: "manual", reason: "update.desktopTooOld" });
		expect(updateRoute({ capabilities: {} })).toEqual({ kind: "manual", reason: "update.manual" });
		expect(updateRoute(undefined)).toEqual({ kind: "manual", reason: "update.manual" });
	});
});

describe("update target", () => {
	it("picks the newest release on the server's own channel", () => {
		expect(releaseChannel("0.1.2")).toBe("stable");
		expect(releaseChannel("0.1.4-nightly.20261020.3700")).toBe("nightly");
		expect(updateTarget(TAGS, "0.1.2")).toBe("0.1.3");
		expect(updateTarget(TAGS, "0.1.4-nightly.20261020.3700")).toBe("0.1.4-nightly.20261027.3783");
		expect(updateTarget(TAGS, "0.1.3-preview.20261001.3600")).toBe("0.1.3-preview.20261026.3702");
	});

	it("offers nothing when the server runs the newest, a newer build, or npm answers oddly", () => {
		expect(updateTarget(TAGS, "0.1.3")).toBeUndefined();
		expect(updateTarget(TAGS, "0.2.0")).toBeUndefined();
		expect(updateTarget({ latest: "next" }, "0.1.2")).toBeUndefined();
		expect(updateTarget(null, "0.1.2")).toBeUndefined();
	});

	it("orders prereleases before their release and nightlies by date", () => {
		expect(compareVersions("0.1.3-preview.20261026.3702", "0.1.3")).toBeLessThan(0);
		expect(compareVersions("0.1.4-nightly.20261027.3783", "0.1.4-nightly.20261026.3780")).toBeGreaterThan(0);
		expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
	});
});

describe("update failures", () => {
	it("shorten T3 Code's reasons to a few words", () => {
		expect(updateFailure("The T3 Code desktop app on this machine is already up to date on 0.1.3.")).toBe("Up to date");
		expect(updateFailure("A server update is already in progress.")).toBe("Already updating");
		expect(updateFailure("Remote updates require the T3 Code background service. Run `t3 service install` on the server machine.")).toBe("Update by hand");
		expect(updateFailure("Could not reach the T3 Code desktop app on this machine.")).toBe("Update failed");
		expect(updateFailure(undefined)).toBe("Update failed");
	});
});
