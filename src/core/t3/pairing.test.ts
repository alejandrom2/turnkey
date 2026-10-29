import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	type Credential,
	findLocalEnvironment,
	normalizeEnvironmentUrl,
	PairingError,
	parsePairingLink,
	preferLoopback,
	redeemPairingCode,
	requestedScopes,
	socketUrl,
} from "./pairing.js";
import { environmentRoute, fakeFetch } from "./testing.js";

beforeEach(() => {
	vi.stubGlobal("fetch", () => Promise.reject(new Error("tests must not use the network")));
	return () => vi.unstubAllGlobals();
});

const URL_ = "http://192.168.1.20:3773";
const tokenRoute = () =>
	Response.json({ access_token: "tok", issued_token_type: "urn:ietf:params:oauth:token-type:access_token", token_type: "Bearer", expires_in: 2_592_000, scope: "orchestration:read orchestration:operate" });

describe("parsePairingLink", () => {
	it("reads the desktop pair link T3 Code creates", () => {
		expect(parsePairingLink("http://192.168.1.20:3773/pair#token=EXAMPLECODE1")).toEqual({ url: URL_, code: "EXAMPLECODE1" });
	});

	it("accepts the older query token and hosted links that name the host", () => {
		expect(parsePairingLink("https://box.ts.net/pair?token=ABC")).toEqual({ url: "https://box.ts.net", code: "ABC" });
		expect(parsePairingLink("https://app.t3.codes/pair?host=https%3A%2F%2Fbox.ts.net%3A8443#token=ABC")).toEqual({ url: "https://box.ts.net:8443", code: "ABC" });
		expect(parsePairingLink("https://app.t3.codes/pair?host=box.ts.net&label=Studio#token=ABC")?.url).toBe("https://box.ts.net");
		expect(parsePairingLink("ws://10.0.0.2:3773/pair#token=ABC")?.url).toBe("http://10.0.0.2:3773");
	});

	it("rejects links without a token or with another scheme", () => {
		expect(parsePairingLink("http://192.168.1.20:3773/pair")).toBeUndefined();
		expect(parsePairingLink("t3code://pair#token=ABC")).toBeUndefined();
		expect(parsePairingLink("not a link")).toBeUndefined();
	});
});

describe("machine URLs", () => {
	it("keep machines saved by older versions as their origin", () => {
		expect(normalizeEnvironmentUrl("http://127.0.0.1:3773/mcp")).toBe("http://127.0.0.1:3773");
		expect(normalizeEnvironmentUrl(" https://box.ts.net/mcp/?x=1#y ")).toBe("https://box.ts.net");
		expect(normalizeEnvironmentUrl("t3code://threads")).toBeUndefined();
	});

	it("talk to a link made on this computer over loopback", () => {
		const interfaces = { en0: [{ address: "192.168.1.20" }] } as unknown as ReturnType<typeof import("node:os").networkInterfaces>;
		expect(preferLoopback(URL_, interfaces)).toBe("http://127.0.0.1:3773");
		expect(preferLoopback("http://192.168.1.99:3773", interfaces)).toBe("http://192.168.1.99:3773");
		expect(preferLoopback("http://localhost:3774", interfaces)).toBe("http://127.0.0.1:3774");
	});
});

describe("redeemPairingCode", () => {
	it("checks the environment, then exchanges the code for a Bearer session without DPoP", async () => {
		const { fetch, calls } = fakeFetch({ "/.well-known/t3/environment": environmentRoute(), "/oauth/token": tokenRoute });
		const credential = await redeemPairingCode(URL_, "CODE", fetch, 1_000);
		expect(calls.map((call) => `${call.method} ${new URL(call.url).pathname}`)).toEqual(["GET /.well-known/t3/environment", "POST /oauth/token"]);
		const exchange = calls[1];
		expect(exchange.headers.has("dpop")).toBe(false);
		expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({
			grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
			subject_token: "CODE",
			subject_token_type: "urn:t3:params:oauth:token-type:environment-bootstrap",
			requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
			scope: "orchestration:read orchestration:operate diagnostics:read source-control:write",
			client_label: "Turnkey",
			client_device_type: "desktop",
			client_os: expect.any(String),
		});
		expect(credential).toEqual({
			token: "tok",
			expiresAt: 1_000 + 2_592_000_000,
			scopes: ["orchestration:read", "orchestration:operate"],
			label: "Studio",
			environmentId: "env-1",
		});
	});

	it("names the client it pairs as, so Sharing & access tells a Stream Deck from a Logitech pairing", async () => {
		const { fetch, calls } = fakeFetch({ "/.well-known/t3/environment": environmentRoute(), "/oauth/token": tokenRoute });
		await redeemPairingCode(URL_, "CODE", fetch, 0, [], "Turnkey (Logitech)");
		expect(new URLSearchParams(calls[1].body).get("client_label")).toBe("Turnkey (Logitech)");
	});

	it("asks for opted-in scopes too, ignoring names it doesn't know, and keeps what the token was granted", async () => {
		const granted = () => Response.json({ access_token: "tok", token_type: "Bearer", expires_in: 60, scope: "orchestration:read orchestration:operate providers:manage" });
		const { fetch, calls } = fakeFetch({ "/.well-known/t3/environment": environmentRoute(), "/oauth/token": granted });
		const credential = await redeemPairingCode(URL_, "CODE", fetch, 0, ["providers:manage", "providers:manage", "everything"]);
		expect(new URLSearchParams(calls[1].body).get("scope")).toBe("orchestration:read orchestration:operate diagnostics:read source-control:write providers:manage");
		expect(credential.scopes).toEqual(["orchestration:read", "orchestration:operate", "providers:manage"]);
		expect(requestedScopes()).toEqual(["orchestration:read", "orchestration:operate", "diagnostics:read", "source-control:write"]);
	});

	it("refuses a reply without a token, and keeps a token whose lifetime is missing for 30 days", async () => {
		const answering = (body: unknown) => fakeFetch({ "/.well-known/t3/environment": environmentRoute(), "/oauth/token": () => Response.json(body) }).fetch;
		const scope = "orchestration:read";
		await expect(redeemPairingCode(URL_, "C", answering({ expires_in: 60, scope }))).rejects.toBeInstanceOf(PairingError);
		await expect(redeemPairingCode(URL_, "C", fakeFetch({ "/.well-known/t3/environment": environmentRoute(), "/oauth/token": () => new Response("<html>") }).fetch)).rejects.toBeInstanceOf(PairingError);
		for (const expires_in of [undefined, "soon", -5]) {
			const credential = await redeemPairingCode(URL_, "C", answering({ access_token: "tok", expires_in, scope }), 1_000);
			expect(credential.expiresAt).toBe(1_000 + 30 * 86_400_000);
		}
	});

	it("does not spend the code on a server with another protocol version", async () => {
		for (const version of [null, 1, 3]) {
			const { fetch, calls } = fakeFetch({ "/.well-known/t3/environment": environmentRoute("env-1", "Old", version), "/oauth/token": tokenRoute });
			await expect(redeemPairingCode(URL_, "CODE", fetch)).rejects.toMatchObject({ kind: "incompatible" });
			expect(calls.some((call) => call.url.endsWith("/oauth/token"))).toBe(false);
		}
	});

	it("explains used codes, links without thread access and unreachable hosts", async () => {
		const failing = (status: number, reason: string) =>
			fakeFetch({
				"/.well-known/t3/environment": environmentRoute(),
				"/oauth/token": () => Response.json({ _tag: "x", reason, traceId: "t" }, { status }),
			}).fetch;
		await expect(redeemPairingCode(URL_, "OLD", failing(401, "invalid_credential"))).rejects.toThrow("already used or has expired");
		await expect(redeemPairingCode(URL_, "C", failing(400, "scope_not_granted"))).rejects.toThrow("doesn't give access to threads");
		await expect(redeemPairingCode(URL_, "C", fakeFetch({}).fetch)).rejects.toThrow("Can't reach T3 Code at 192.168.1.20:3773");
	});
});

describe("socketUrl", () => {
	const credential: Credential = { token: "tok", expiresAt: Number.MAX_SAFE_INTEGER, scopes: [], label: "", environmentId: "env-1" };

	it("mints a ticket with the Bearer token and asks for protocol 2", async () => {
		const { fetch, calls } = fakeFetch({
			"/.well-known/t3/environment": environmentRoute(),
			"/api/auth/websocket-ticket/rpc": () => Response.json({ ticket: "a.b/c", expiresAt: "" }),
		});
		expect(await socketUrl(URL_, credential, fetch)).toBe("ws://192.168.1.20:3773/ws?orchestrationProtocol=2&wsTicket=a.b%2Fc");
		expect(calls[1].headers.get("authorization")).toBe("Bearer tok");
	});

	it("falls back to the unbound ticket path on older servers", async () => {
		const { fetch } = fakeFetch({
			"/.well-known/t3/environment": environmentRoute(),
			"/api/auth/websocket-ticket/rpc": () => new Response(null, { status: 404 }),
			"/api/auth/websocket-ticket": () => Response.json({ ticket: "old" }),
		});
		expect(await socketUrl("https://box.ts.net", credential, fetch)).toBe("wss://box.ts.net/ws?orchestrationProtocol=2&wsTicket=old");
	});

	it("asks for a new pair link when T3 Code rejects the token", async () => {
		const { fetch } = fakeFetch({
			"/.well-known/t3/environment": environmentRoute(),
			"/api/auth/websocket-ticket/rpc": () => Response.json({ reason: "invalid_credential" }, { status: 401 }),
		});
		const error = await socketUrl(URL_, credential, fetch).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(PairingError);
		expect(error).toMatchObject({ kind: "repair", fatal: true });
	});

	it("refuses a different environment answering at the same address", async () => {
		const { fetch } = fakeFetch({ "/.well-known/t3/environment": environmentRoute("env-other") });
		await expect(socketUrl(URL_, credential, fetch)).rejects.toThrow("different T3 Code");
	});
});

describe("findLocalEnvironment", () => {
	it("picks the first port that answers as T3 Code", async () => {
		const { fetch } = fakeFetch({});
		const probe = (async (url: string, init?: RequestInit) => {
			if (url.includes(":3773/")) return fetch(url, init);
			if (url.includes(":3774/")) return Response.json({ resource_name: "Something else" });
			return Response.json({ environmentId: "env-local" });
		}) as typeof globalThis.fetch;
		expect(await findLocalEnvironment(probe)).toEqual({ url: "http://127.0.0.1:3775", environmentId: "env-local" });
	});

	it("finds nothing when T3 Code is not running", async () => {
		expect(await findLocalEnvironment(fakeFetch({}).fetch)).toBeUndefined();
	});
});
