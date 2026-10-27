import { describe, expect, it } from "vitest";

import { diagnosticsReport, type DiagnosticsInput, hostOf, recentProblems, redact, VERBOSE_MS, verboseOn } from "./diagnostics.js";

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const TOKEN = "t3tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0";
const CODE = "PAIRCODE42";
const SIGNED = "sig_a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4";

const input = (patch: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
	now: NOW,
	plugin: "0.1.0.0",
	streamDeck: "7.1.0",
	os: { platform: "mac", version: "15.1", arch: "arm64" },
	node: "v24.0.0",
	verboseUntil: undefined,
	settings: {},
	machines: [],
	actions: {},
	log: "",
	...patch,
});

describe("verbose logging", () => {
	it("stays on until its end time", () => {
		expect(verboseOn(undefined, NOW)).toBe(false);
		expect(verboseOn(NOW + VERBOSE_MS, NOW)).toBe(true);
		expect(verboseOn(NOW, NOW)).toBe(false);
	});
});

describe("redact", () => {
	it("keeps a URL's host only and blanks tokens, auth headers and long opaque strings", () => {
		expect(redact(`Pairing with https://studio.tail1.ts.net:3773/pair#token=${CODE} failed`)).toBe("Pairing with https://studio.tail1.ts.net:3773 failed");
		expect(redact(`Authorization: Bearer ${TOKEN}`)).not.toContain(TOKEN);
		expect(redact(`{"token":"${TOKEN}","label":"Studio"}`)).toBe('{"token":[redacted],"label":"Studio"}');
		expect(redact(`ws ticket=${CODE}&x=1`)).not.toContain(CODE);
		expect(redact(`opaque ${SIGNED} here`)).toBe("opaque [redacted] here");
		expect(redact("com.alejandrom2.t3deck.dial.threads failed")).toBe("com.alejandrom2.t3deck.dial.threads failed");
	});

	it("reads hosts without throwing on junk", () => {
		expect(hostOf("http://127.0.0.1:3773/?token=x#y")).toBe("127.0.0.1:3773");
		expect(hostOf("not a url")).toBe("?");
	});
});

describe("recentProblems", () => {
	it("keeps the last warnings and errors with their stack lines, redacted", () => {
		const log = [
			"2026-10-27T11:00:00.000Z INFO  deck: ready",
			`2026-10-27T11:00:01.000Z WARN  actions: com.alejandrom2.t3deck.send failed: denied at https://host:3773/x?token=${TOKEN}`,
			"2026-10-27T11:00:02.000Z ERROR Process encountered uncaught exception",
			"Error: boom",
			"    at main (plugin.js:1:1)",
			"2026-10-27T11:00:03.000Z DEBUG deck: noise",
			"    not part of anything",
		].join("\n");
		expect(recentProblems(log)).toEqual([
			"2026-10-27T11:00:01.000Z WARN  actions: com.alejandrom2.t3deck.send failed: denied at https://host:3773",
			"2026-10-27T11:00:02.000Z ERROR Process encountered uncaught exception\nError: boom\n    at main (plugin.js:1:1)",
		]);
		expect(recentProblems(log, 1)).toHaveLength(1);
	});
});

describe("diagnosticsReport", () => {
	it("never carries a credential, given settings and machines that hold them", () => {
		const settings = {
			environments: `https://studio.tail1.ts.net:3773/#token=${CODE}\nhttp://192.168.1.5:3773`,
			motion: "reduced",
			auth: { "http://127.0.0.1:3773": { token: TOKEN, expiresAt: NOW, scopes: ["orchestration:read"], label: "Mac", environmentId: "env-1" } },
			scopeRequests: { "http://127.0.0.1:3773": ["providers:manage"] },
			pairingCode: CODE,
		};
		const machine = {
			url: `https://studio.tail1.ts.net:3773/pair?code=${CODE}#token=${TOKEN}`,
			state: "error",
			message: `Unreachable: wss://studio.tail1.ts.net:3773/ws?ticket=${SIGNED}`,
			scopes: ["orchestration:read", "orchestration:operate", TOKEN],
			environmentId: "env-2",
			token: TOKEN,
			credential: { token: TOKEN },
		};
		const report = diagnosticsReport(
			input({
				verboseUntil: NOW + 1000,
				settings,
				machines: [machine],
				actions: { "com.alejandrom2.t3deck.health": 2, "com.alejandrom2.t3deck.stop": 0 },
				log: `2026-10-27T11:00:01.000Z WARN  deck: Pairing with https://host/pair#token=${CODE} failed: Bearer ${TOKEN}\n2026-10-27T11:00:02.000Z ERROR rpc: {"access_token":"${TOKEN}"} link ${SIGNED}`,
			}),
		);
		const text = JSON.stringify(report);
		for (const secret of [TOKEN, CODE, SIGNED, "#token", "?code", "ticket=s", "auth\"", "scopeRequests"]) expect(text).not.toContain(secret);
		expect(report.settings).toEqual({ motion: "reduced", addedMachines: 2 });
		expect(report.machines).toEqual([
			{ host: "studio.tail1.ts.net:3773", state: "error", message: "Unreachable: wss://studio.tail1.ts.net:3773", scopes: ["orchestration:read", "orchestration:operate"], environmentId: "env-2" },
		]);
		expect(report.actions).toEqual({ "com.alejandrom2.t3deck.health": 2 });
		expect(report.verboseLoggingUntil).toBe("2026-10-27T12:00:01.000Z");
		expect(report.recentProblems).toHaveLength(2);
	});
});
