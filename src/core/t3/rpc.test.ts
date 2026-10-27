import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type Credential, socketUrl } from "./pairing.js";
import { causeError, RpcError, RpcSocket, type RpcState, retryDelayMs } from "./rpc.js";
import { environmentRoute, fakeFetch, fakeSockets } from "./testing.js";

beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("fetch", () => Promise.reject(new Error("tests must not use the network")));
	vi.stubGlobal("WebSocket", class {
		constructor() {
			throw new Error("tests must not open real sockets");
		}
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

const flush = () => vi.advanceTimersByTimeAsync(0);

function harness(authorize: () => Promise<string> = async () => "ws://test/ws?orchestrationProtocol=2&wsTicket=t") {
	const sockets = fakeSockets();
	const states: RpcState[] = [];
	const opened = vi.fn();
	const warn = vi.fn();
	const rpc = new RpcSocket({ authorize, socket: sockets.factory, onState: (state) => states.push(state), onOpen: opened, warn, random: () => 0 });
	return { rpc, sockets, states, opened, warn };
}

async function connected(authorize?: () => Promise<string>) {
	const h = harness(authorize);
	h.rpc.start();
	await flush();
	h.sockets.last.open();
	return h;
}

describe("RpcSocket requests", () => {
	it("sends Effect RPC requests with empty headers and resolves on a success Exit", async () => {
		const { rpc, sockets } = await connected();
		const result = rpc.request("server.probe", {});
		expect(sockets.last.sent).toEqual([{ _tag: "Request", id: 0, tag: "server.probe", payload: {}, headers: [] }]);
		sockets.last.receive({ _tag: "Exit", requestId: 0, exit: { _tag: "Success", value: {} } });
		await expect(result).resolves.toEqual({});
		rpc.stop();
	});

	it("rejects with the typed error from a failure Exit", async () => {
		const { rpc, sockets } = await connected();
		const result = rpc.request("orchestration.dispatchCommand", { type: "thread.stop" });
		sockets.last.receive({
			_tag: "Exit",
			requestId: 0,
			exit: {
				_tag: "Failure",
				cause: [{ _tag: "Fail", error: { _tag: "EnvironmentAuthorizationError", message: "The authenticated token is missing required scope: orchestration:operate." } }],
			},
		});
		await expect(result).rejects.toMatchObject({ tag: "EnvironmentAuthorizationError", message: expect.stringContaining("orchestration:operate") });
		const unknown = rpc.request("orchestration.nope", {});
		sockets.last.receive({ _tag: "Exit", requestId: 1, exit: { _tag: "Failure", cause: [{ _tag: "Die", defect: "Unknown request tag: orchestration.nope" }] } });
		await expect(unknown).rejects.toMatchObject({ tag: "Die", message: "Unknown request tag: orchestration.nope" });
		rpc.stop();
	});

	it("skips malformed frames instead of throwing, and still settles a request whose Exit is garbled", async () => {
		const { rpc, sockets, warn } = await connected();
		const result = rpc.request("server.probe", {});
		for (const frame of [null, 7, "x", { _tag: "Chunk", requestId: 0, values: "abc" }, [null, { _tag: "Exit" }]]) expect(() => sockets.last.receive(frame)).not.toThrow();
		sockets.last.receive({ _tag: "Exit", requestId: 0 });
		await expect(result).rejects.toBeInstanceOf(RpcError);
		expect(() => causeError("junk" as never)).not.toThrow();
		expect(warn).not.toHaveBeenCalledWith(expect.stringContaining("wsTicket"));
		rpc.stop();
	});

	it("rejects a request T3 Code never answers once its timeout passes, keeping the socket", async () => {
		const { rpc, sockets } = await connected();
		const result = rpc.request("server.getConfig", {}, 15_000);
		const settled = expect(result).rejects.toMatchObject({ tag: "Timeout" });
		await vi.advanceTimersByTimeAsync(15_000);
		await settled;
		expect(sockets.last.closed).toBe(false);
		rpc.stop();
	});

	it("fails fast while disconnected and rejects in-flight requests when the socket drops", async () => {
		const { rpc, sockets } = harness();
		await expect(rpc.request("server.probe", {})).rejects.toBeInstanceOf(RpcError);
		rpc.start();
		await flush();
		sockets.last.open();
		const inflight = rpc.request("server.probe", {});
		sockets.last.drop();
		await expect(inflight).rejects.toMatchObject({ tag: "Disconnected" });
		rpc.stop();
	});
});

describe("RpcSocket streams", () => {
	it("acks every chunk once, however many values it carries", async () => {
		const { rpc, sockets } = await connected();
		const values: unknown[] = [];
		rpc.subscribe("orchestration.subscribeShell", () => ({}), (value) => values.push(value), { persistent: true });
		const socket = sockets.last;
		socket.receive({ _tag: "Chunk", requestId: 0, values: [{ kind: "snapshot" }, { kind: "synchronized" }] });
		socket.receive({ _tag: "Chunk", requestId: 0, values: [{ kind: "thread.updated", sequence: 4812 }] });
		expect(values).toEqual([{ kind: "snapshot" }, { kind: "synchronized" }, { kind: "thread.updated", sequence: 4812 }]);
		expect(socket.sent.filter((frame) => frame._tag === "Ack")).toEqual([
			{ _tag: "Ack", requestId: 0 },
			{ _tag: "Ack", requestId: 0 },
		]);
		rpc.stop();
	});

	it("still acks when handling a value throws, so the stream never stalls, and logs instead of crashing", async () => {
		const { rpc, sockets, warn } = await connected();
		rpc.subscribe("s", () => ({}), () => {
			throw new Error("bad item");
		});
		expect(() => sockets.last.receive({ _tag: "Chunk", requestId: 0, values: [1] })).not.toThrow();
		expect(sockets.last.sent.at(-1)).toEqual({ _tag: "Ack", requestId: 0 });
		expect(warn).toHaveBeenCalledWith(expect.stringContaining("bad item"));
		rpc.stop();
	});

	it("interrupts on unsubscribe and ignores what arrives after", async () => {
		const { rpc, sockets } = await connected();
		const onValue = vi.fn();
		const unsubscribe = rpc.subscribe("orchestration.subscribeThread", () => ({ threadId: "t" }), onValue);
		unsubscribe();
		const socket = sockets.last;
		expect(socket.sent.at(-1)).toEqual({ _tag: "Interrupt", requestId: 0 });
		socket.receive({ _tag: "Chunk", requestId: 0, values: [1] });
		socket.receive({ _tag: "Exit", requestId: 0, exit: { _tag: "Failure", cause: [{ _tag: "Interrupt", fiberId: 17 }] } });
		expect(onValue).not.toHaveBeenCalled();
		expect(socket.sent.filter((frame) => frame._tag === "Ack")).toEqual([]);
		rpc.stop();
	});

	it("ends one-shot streams on disconnect but re-sends persistent ones with a fresh payload", async () => {
		const { rpc, sockets } = await connected();
		let cursor = 0;
		const ended = vi.fn();
		rpc.subscribe("orchestration.subscribeThread", () => ({ threadId: "t" }), () => undefined, { onEnd: ended });
		rpc.subscribe("orchestration.subscribeShell", () => (cursor === 0 ? {} : { afterSequence: cursor }), () => (cursor = 42), { persistent: true });
		sockets.last.receive({ _tag: "Chunk", requestId: 1, values: [{}] });
		sockets.last.drop();
		expect(ended).toHaveBeenCalledWith(expect.objectContaining({ tag: "Disconnected" }));

		await vi.advanceTimersByTimeAsync(retryDelayMs(1, 0));
		sockets.last.open();
		expect(sockets.sockets).toHaveLength(2);
		expect(sockets.last.sent).toEqual([{ _tag: "Request", id: 2, tag: "orchestration.subscribeShell", payload: { afterSequence: 42 }, headers: [] }]);
		rpc.stop();
	});
});

describe("RpcSocket keepalive and reconnect", () => {
	it("pings every 5 s and drops a socket that stays silent for 15 s", async () => {
		const { rpc, sockets, states } = await connected();
		const first = sockets.last;
		await vi.advanceTimersByTimeAsync(5_000);
		expect(first.sent).toEqual([{ _tag: "Ping" }]);
		first.receive({ _tag: "Pong" });
		await vi.advanceTimersByTimeAsync(15_000);
		expect(first.closed).toBe(false);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(first.closed).toBe(true);
		expect(states.at(-1)).toMatchObject({ kind: "retrying", error: { message: "T3 Code stopped answering." } });
		rpc.stop();
	});

	it("backs off like T3 Code's supervisor", () => {
		expect([1, 2, 3, 9, 20].map((failures) => retryDelayMs(failures, 0))).toEqual([1_000, 2_000, 4_000, 150_000, 150_000]);
		expect(retryDelayMs(1, 1)).toBe(2_000);
	});

	it("mints a fresh ticket for every connection attempt", async () => {
		let minted = 0;
		const { fetch, calls } = fakeFetch({
			"/.well-known/t3/environment": environmentRoute(),
			"/api/auth/websocket-ticket/rpc": () => Response.json({ ticket: `ticket-${++minted}` }),
		});
		const credential: Credential = { token: "tok", expiresAt: Number.MAX_SAFE_INTEGER, scopes: [], label: "", environmentId: "env-1" };
		const { rpc, sockets } = await connected(() => socketUrl("http://studio:3773", credential, fetch));
		sockets.last.drop();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(sockets.sockets.map((socket) => new URL(socket.url).searchParams.get("wsTicket"))).toEqual(["ticket-1", "ticket-2"]);
		expect(calls.filter((call) => call.url.endsWith("/websocket-ticket/rpc"))).toHaveLength(2);
		rpc.stop();
	});

	it("stops for good when T3 Code rejects the token instead of retrying", async () => {
		const { fetch, calls } = fakeFetch({
			"/.well-known/t3/environment": environmentRoute(),
			"/api/auth/websocket-ticket/rpc": () => Response.json({ reason: "invalid_credential" }, { status: 401 }),
		});
		const credential: Credential = { token: "revoked", expiresAt: Number.MAX_SAFE_INTEGER, scopes: [], label: "", environmentId: "env-1" };
		const { rpc, sockets, states } = harness(() => socketUrl("http://studio:3773", credential, fetch));
		rpc.start();
		await flush();
		await vi.advanceTimersByTimeAsync(600_000);
		expect(sockets.sockets).toEqual([]);
		expect(calls.filter((call) => call.url.endsWith("/websocket-ticket/rpc"))).toHaveLength(1);
		expect(states.at(-1)).toMatchObject({ kind: "stopped", error: { kind: "repair" } });
	});

	it("retries transient failures and resets the backoff on wake", async () => {
		let up = false;
		const { rpc, sockets, states } = harness(async () => {
			if (!up) throw new Error("Can't reach T3 Code.");
			return "ws://test/ws";
		});
		rpc.start();
		await flush();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(states.filter((state) => state.kind === "retrying").map((state) => state.kind === "retrying" && state.delayMs)).toEqual([1_000, 2_000]);
		up = true;
		rpc.wake();
		await flush();
		expect(sockets.sockets).toHaveLength(1);
		rpc.stop();
	});
});

describe("causeError", () => {
	it("keeps requiredPermission and falls back to an error's own detail for its reason", () => {
		const denied = causeError([{ _tag: "Fail", error: { _tag: "EnvironmentAuthorizationError", message: "missing", requiredPermission: "source-control:write" } }]);
		expect(denied).toMatchObject({ tag: "EnvironmentAuthorizationError", requiredPermission: "source-control:write", reason: undefined });
		const off = causeError([{ _tag: "Fail", error: { _tag: "PullRequestOperationError", detail: "Review guides are off. Turn them on in Settings → Source Control." } }]);
		expect(off.reason).toBe("Review guides are off. Turn them on in Settings → Source Control.");
	});
});
