// Test doubles for the client API. Tests must never reach a real T3 Code (one runs on this machine).
import type { SocketLike } from "./rpc.js";

export class FakeSocket implements SocketLike {
	readonly sent: Record<string, unknown>[] = [];
	closed = false;
	onopen: ((event: unknown) => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: ((event: unknown) => void) | null = null;
	onerror: ((event: unknown) => void) | null = null;

	constructor(readonly url: string) {}

	send(data: string): void {
		this.sent.push(JSON.parse(data) as Record<string, unknown>);
	}

	close(): void {
		this.closed = true;
	}

	open(): void {
		this.onopen?.({});
	}

	receive(frame: unknown): void {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}

	drop(): void {
		this.onclose?.({});
	}

	/** The last request this socket sent for `tag`. */
	request(tag: string): { id: number; payload: Record<string, unknown> } {
		const found = this.sent.filter((frame) => frame._tag === "Request" && frame.tag === tag).at(-1);
		if (found === undefined) throw new Error(`no ${tag} request`);
		return found as { id: number; payload: Record<string, unknown> };
	}

	reply(tag: string, value: unknown): void {
		this.receive({ _tag: "Exit", requestId: this.request(tag).id, exit: { _tag: "Success", value } });
	}
}

export function fakeSockets() {
	const sockets: FakeSocket[] = [];
	return {
		sockets,
		factory: (url: string) => {
			const socket = new FakeSocket(url);
			sockets.push(socket);
			return socket;
		},
		get last(): FakeSocket {
			const socket = sockets.at(-1);
			if (socket === undefined) throw new Error("no socket opened");
			return socket;
		},
	};
}

export type FakeRoute = (request: { url: string; method: string; headers: Headers; body: string }) => Response | Promise<Response>;

/** A fetch that answers from `routes` by path and records every call. Unknown paths fail like a dead port. */
export function fakeFetch(routes: Record<string, FakeRoute>) {
	const calls: { url: string; method: string; headers: Headers; body: string }[] = [];
	const fetchFn = (async (input: string | URL, init: RequestInit = {}) => {
		const url = String(input);
		const request = { url, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body === undefined ? "" : String(init.body) };
		calls.push(request);
		const route = routes[new URL(url).pathname];
		if (route === undefined) throw new TypeError("fetch failed");
		return route(request);
	}) as typeof fetch;
	return { fetch: fetchFn, calls };
}

/** `version: null` leaves the field out, as servers from before protocol versioning do. */
export const environmentRoute =
	(environmentId = "env-1", label = "Studio", version: number | null = 2): FakeRoute =>
	() =>
		Response.json({
			environmentId,
			label,
			platform: { os: "darwin", arch: "arm64" },
			serverVersion: "1.0.0",
			...(version === null ? {} : { orchestrationProtocolVersion: version }),
			capabilities: {},
		});
