import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { environmentRoute, FakeSocket } from "./core/t3/testing.js";

type Settings = Record<string, unknown>;

const sd = vi.hoisted(() => {
	const state = {
		stored: {} as Record<string, unknown>,
		onGlobal: undefined as ((ev: { settings: Record<string, unknown> }) => void) | undefined,
		onLaunch: undefined as (() => void) | undefined,
		onTerminate: undefined as (() => void) | undefined,
		switches: [] as [string, string | undefined][],
	};
	const noop = () => ({ dispose: () => undefined });
	return {
		state,
		streamDeck: {
			logger: { createScope: () => ({ warn: () => undefined, debug: () => undefined }), setLevel: () => undefined, warn: () => undefined },
			settings: {
				getGlobalSettings: async () => state.stored,
				setGlobalSettings: async (settings: Record<string, unknown>) => void (state.stored = settings),
				onDidReceiveGlobalSettings: (listener: (ev: { settings: Record<string, unknown> }) => void) => {
					state.onGlobal = listener;
					return { dispose: () => undefined };
				},
				onDidReceiveSettings: noop,
			},
			ui: { action: undefined, onDidAppear: noop, sendToPropertyInspector: async () => undefined },
			system: {
				onSystemDidWakeUp: noop,
				onApplicationDidLaunch: (listener: () => void) => void (state.onLaunch = listener),
				onApplicationDidTerminate: (listener: () => void) => void (state.onTerminate = listener),
				openUrl: async () => undefined,
			},
			info: { application: { font: ".AppleSystemUIFont" } },
			profiles: { switchToProfile: async (device: string, profile?: string) => void state.switches.push([device, profile]) },
			devices: [
				{ id: "plus", type: 7, isConnected: true },
				{ id: "mobile", type: 3, isConnected: true },
			],
		},
	};
});

vi.mock("@elgato/streamdeck", () => ({ default: sd.streamDeck }));

const STUDIO = "http://studio:3773";
const LINK = `${STUDIO}/pair#token=CODE`;

/** A gate a fetch waits on until the test opens it. */
function gate() {
	let open!: () => void;
	const opened = new Promise<void>((resolve) => (open = resolve));
	return { opened, open };
}

/**
 * Nothing answers on loopback (after `local` opens); the studio machine answers its preflight and tickets, and
 * its token exchange after `token` opens.
 */
function network() {
	const local = gate();
	const token = gate();
	local.open();
	token.open();
	const gates = { local, token };
	vi.stubGlobal("fetch", async (input: string | URL) => {
		const url = new URL(String(input));
		if (url.hostname === "127.0.0.1") {
			await gates.local.opened;
			throw new TypeError("fetch failed");
		}
		switch (url.pathname) {
			case "/.well-known/t3/environment":
				return environmentRoute()({ url: url.href, method: "GET", headers: new Headers(), body: "" });
			case "/oauth/token":
				await gates.token.opened;
				return Response.json({ access_token: "tok", expires_in: 2_592_000, scope: "orchestration:read orchestration:operate" });
			case "/api/auth/websocket-ticket/rpc":
				return Response.json({ ticket: "t" });
			default:
				throw new TypeError("fetch failed");
		}
	});
	return {
		holdLocal: () => (gates.local = gate()),
		holdToken: () => (gates.token = gate()),
	};
}

async function load(stored: Settings = {}) {
	sd.state.stored = stored;
	sd.state.switches = [];
	sd.streamDeck.info.application.font = ".AppleSystemUIFont";
	vi.resetModules();
	const { deck } = await import("./deck.js");
	await deck.init();
	return deck;
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const urls = (deck: { machines: { url: string }[] }) => deck.machines.map((machine) => machine.url);

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("WebSocket", FakeSocket);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe("Deck pairing", () => {
	it("keeps a machine that is still pairing when settings are applied meanwhile", async () => {
		const net = network();
		const deck = await load();
		const token = net.holdToken();
		const pairing = deck.pair(LINK);
		await flush();
		await deck.retry();
		token.open();
		await pairing;
		expect(urls(deck)).toEqual([STUDIO]);
		await deck.retry();
		expect(urls(deck)).toEqual([STUDIO]);
	});
});

describe("Deck settings", () => {
	it("keeps the machines it paired when the inspector writes an older copy of global settings", async () => {
		network();
		const deck = await load();
		await deck.pair(LINK);
		sd.state.onGlobal?.({ settings: { motion: "off" } });
		await flush();
		expect(urls(deck)).toEqual([STUDIO]);
		expect(sd.state.stored).toMatchObject({ environments: STUDIO, motion: "off" });
	});

	it("applies against current settings, not the ones a slower apply started from", async () => {
		const net = network();
		const deck = await load();
		const local = net.holdLocal();
		const retrying = deck.retry();
		await flush();
		await deck.pair(LINK);
		local.open();
		await retrying;
		expect(urls(deck)).toEqual([STUDIO]);
	});
});

describe("Deck auto-switch", () => {
	it("puts a deck on its Turnkey profile while T3 Code runs, and back when it quits", async () => {
		network();
		const deck = await load();
		sd.state.onLaunch?.();
		deck.setVisible("key", "plus");
		sd.state.onTerminate?.();
		expect(sd.state.switches).toEqual([
			["plus", "profiles/turnkey-plus"],
			["plus", undefined],
		]);
	});

	it("leaves a deck the user moved to another profile", async () => {
		network();
		const deck = await load();
		sd.state.onLaunch?.();
		deck.setVisible("key", "plus");
		deck.setVisible("key", undefined);
		sd.state.onTerminate?.();
		expect(sd.state.switches).toEqual([["plus", "profiles/turnkey-plus"]]);
	});

	it("never switches under OpenDeck, which has none of Turnkey's profiles", async () => {
		network();
		const deck = await load();
		sd.streamDeck.info.application.font = "ui-sans-serif";
		sd.state.onLaunch?.();
		deck.setVisible("key", "plus");
		sd.state.onTerminate?.();
		expect(sd.state.switches).toEqual([]);
	});

	it("doesn't switch when Auto-switch is off", async () => {
		network();
		await load({ autoSwitch: "off" });
		sd.state.onLaunch?.();
		sd.state.onTerminate?.();
		expect(sd.state.switches).toEqual([]);
	});
});
