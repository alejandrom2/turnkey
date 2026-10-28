import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../i18n.js";
import type { CredentialStore } from "./machine.js";
import { Machines } from "./machines.js";
import type { Credential } from "./pairing.js";
import { environmentRoute, fakeFetch, fakeSockets, type FakeRoute } from "./testing.js";

beforeEach(() => {
	vi.stubGlobal("fetch", () => Promise.reject(new Error("tests must not use the network")));
	return () => vi.unstubAllGlobals();
});

const REMOTE = "https://box.ts.net";
const LINK = `${REMOTE}/pair#token=CODE`;
const credential = (environmentId = "env-1"): Credential => ({ token: "tok", expiresAt: Date.now() + 86_400_000, scopes: ["orchestration:read"], label: "Studio", environmentId });

function memoryStore(initial: Record<string, Credential> = {}) {
	const saved = new Map(Object.entries(initial));
	const store: CredentialStore = {
		load: (url) => saved.get(url),
		save: async (url, value) => void (value ? saved.set(url, value) : saved.delete(url)),
		urls: () => [...saved.keys()],
	};
	return store;
}

/** Answers the environment descriptor only for `origins`, so the local probe finds T3 Code on one port. */
const environmentAt =
	(...origins: string[]): FakeRoute =>
	(request) =>
		origins.includes(new URL(request.url).origin) ? environmentRoute()(request) : new Response("", { status: 404 });

const tokenRoute = () => Response.json({ access_token: "fresh", token_type: "Bearer", expires_in: 2_592_000, scope: "orchestration:read orchestration:operate" });

let machines: Machines | undefined;
afterEach(() => {
	for (const machine of machines?.all ?? []) machine.stop();
	machines = undefined;
});

function setup(store: CredentialStore, routes: Record<string, FakeRoute>) {
	const { fetch } = fakeFetch(routes);
	machines = new Machines(store, { fetch, socket: fakeSockets().factory, clientLabel: "Turnkey (Test)" }, () => {});
	return machines;
}

describe("Machines", () => {
	it("follows this computer's T3 Code to a new port, keeping its pairing", async () => {
		const store = memoryStore({ "http://127.0.0.1:3773": credential() });
		const m = setup(store, { "/.well-known/t3/environment": environmentAt("http://127.0.0.1:3774") });
		await m.sync(() => []);
		expect(store.urls()).toEqual(["http://127.0.0.1:3774"]);
		expect(m.all.map((machine) => machine.url)).toEqual(["http://127.0.0.1:3774"]);
	});

	it("doesn't move a pairing onto a port that has one", async () => {
		const store = memoryStore({ "http://127.0.0.1:3773": credential(), "http://127.0.0.1:3774": credential() });
		const m = setup(store, { "/.well-known/t3/environment": environmentAt("http://127.0.0.1:3774") });
		await m.sync(() => []);
		expect(store.urls()).toEqual(["http://127.0.0.1:3773", "http://127.0.0.1:3774"]);
	});

	it("keeps what it's told to, drops the rest", async () => {
		const m = setup(memoryStore(), {});
		await m.sync(() => ["http://a:3773"]);
		const a = m.get("http://a:3773");
		if (a === undefined) throw new Error("a wasn't started");
		const stop = vi.spyOn(a, "stop");
		await m.sync(() => ["http://b:3773"]);
		expect(m.all.map((machine) => machine.url)).toEqual(["http://b:3773"]);
		expect(stop).toHaveBeenCalled();
	});

	it("rolls back a machine it added when pairing fails", async () => {
		const m = setup(memoryStore(), { "/.well-known/t3/environment": environmentAt(REMOTE), "/oauth/token": () => new Response("", { status: 401 }) });
		await expect(m.pair(LINK)).rejects.toThrow(t("pairing.linkUsed"));
		expect(m.get(REMOTE)).toBeUndefined();
	});

	it("keeps an existing machine when re-pairing fails", async () => {
		const m = setup(memoryStore(), { "/.well-known/t3/environment": environmentAt(REMOTE), "/oauth/token": () => new Response("", { status: 401 }) });
		await m.sync(() => [REMOTE]);
		await expect(m.pair(LINK)).rejects.toThrow();
		expect(m.get(REMOTE)).toBeDefined();
	});

	it("keeps a machine that is pairing", async () => {
		const store = memoryStore();
		let answer: ((response: Response) => void) | undefined;
		const m = setup(store, { "/.well-known/t3/environment": environmentAt(REMOTE), "/oauth/token": () => new Promise<Response>((resolve) => (answer = resolve)) });
		const paired = m.pair(LINK);
		await vi.waitFor(() => expect(answer).toBeDefined());
		await m.sync(() => []);
		answer?.(tokenRoute());
		const { url, credential: fresh } = await paired;
		expect(url).toBe(REMOTE);
		expect(m.get(REMOTE)).toBeDefined();
		expect(store.load(REMOTE)).toEqual(fresh);
		expect(fresh.token).toBe("fresh");
	});

	it("doesn't drop a machine that paired while it looked for this computer", async () => {
		let release: (() => void) | undefined;
		const held = new Promise<void>((resolve) => (release = resolve));
		const m = setup(memoryStore(), {
			"/.well-known/t3/environment": async (request) => {
				if (new URL(request.url).origin === REMOTE) return environmentRoute()(request);
				await held;
				return new Response("", { status: 404 });
			},
			"/oauth/token": tokenRoute,
		});
		const kept: string[] = [];
		const synced = m.sync(() => kept);
		const { url } = await m.pair(LINK);
		kept.push(url);
		const machine = m.get(url);
		if (machine === undefined) throw new Error("pairing didn't add the machine");
		const stop = vi.spyOn(machine, "stop");
		release?.();
		await synced;
		expect(m.get(url)).toBe(machine);
		expect(stop).not.toHaveBeenCalled();
	});

	it("rejects a link that isn't one", async () => {
		await expect(setup(memoryStore(), {}).pair("nope")).rejects.toThrow(t("pairing.notALink"));
	});
});
