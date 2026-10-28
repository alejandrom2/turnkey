import { describe, expect, it } from "vitest";

import { t } from "../core/i18n.js";
import { pluginStatus } from "./status.js";

const PAGE = "http://127.0.0.1:5000/pair/abc";
const pair = { url: PAGE, urlTitle: t("logi.status.pair") };

describe("pluginStatus", () => {
	it("asks for a pair link while nothing is paired", () => {
		expect(pluginStatus([], PAGE)).toEqual({ type: "status", level: "warning", message: t("logi.status.unpaired"), ...pair });
		expect(pluginStatus([{ kind: "signed-out" }], PAGE)).toEqual({ type: "status", level: "warning", message: t("logi.status.unpaired"), ...pair });
	});

	it("says why a pairing stopped working, with the way to pair again", () => {
		expect(pluginStatus([{ kind: "signed-out", message: t("machine.pairingExpired") }], PAGE)).toEqual({ type: "status", level: "error", message: t("machine.pairingExpired"), ...pair });
		expect(pluginStatus([{ kind: "error", message: "boom" }], PAGE)).toEqual({ type: "status", level: "error", message: "boom", ...pair });
	});

	it("is fine once one machine is ready, whatever the others do", () => {
		expect(pluginStatus([{ kind: "error", message: "boom" }, { kind: "ready", environmentId: "e", label: "Studio", canOperate: true }], PAGE)).toEqual({
			type: "status",
			level: "normal",
			message: t("logi.status.connected", { name: "Studio" }),
		});
	});

	it("is fine while connecting", () => {
		expect(pluginStatus([{ kind: "connecting" }], PAGE)).toEqual({ type: "status", level: "normal", message: t("health.connecting") });
	});
});
