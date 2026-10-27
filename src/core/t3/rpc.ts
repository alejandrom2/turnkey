/**
 * Effect RPC over one WebSocket, JSON framing, without Effect: one object per text frame, `headers: []`,
 * an Ack after every Chunk (the server waits for it before sending more), and a Ping every 5 s.
 * Reconnects with T3 Code's supervisor backoff and re-sends live subscriptions on every new socket.
 */

import { t } from "../i18n.js";

/** The slice of the WHATWG WebSocket the client uses; Node 24's global `WebSocket` fits. */
export interface SocketLike {
	send(data: string): void;
	close(code?: number, reason?: string): void;
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: { data: unknown }) => void) | null;
	onclose: ((event: unknown) => void) | null;
	onerror: ((event: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

/**
 * A failed RPC: `tag` is the typed error's `_tag`, or `Die`, `Interrupt`, `Disconnected`. `reason` is the
 * human sentence T3 Code buried in the error's cause chain, such as why a provider switch was refused.
 * `requiredPermission` names the scope an `EnvironmentAuthorizationError` wanted; its `requiredScope` is only
 * the legacy parent older clients understand, so it is not kept.
 */
export class RpcError extends Error {
	constructor(
		readonly tag: string,
		message: string,
		readonly reason?: string,
		readonly requiredPermission?: string,
		/** A tagged error's own `reason` literal, such as a stopped workflow's "not-running". */
		readonly code?: string,
	) {
		super(message);
	}
}

/** The innermost string cause: dispatch errors wrap a policy's plain-text reason in generic messages. */
export function causeReason(error: unknown): string | undefined {
	let reason: string | undefined;
	for (let cause = (error as { cause?: unknown } | null)?.cause, depth = 0; cause != null && depth < 8; depth++) {
		if (typeof cause === "string") {
			reason = cause.trim() || reason;
			break;
		}
		cause = (cause as { cause?: unknown }).cause;
	}
	return reason !== undefined && reason.length <= 160 ? reason : undefined;
}

export type RpcState =
	| { kind: "connecting" }
	| { kind: "open" }
	| { kind: "retrying"; error: Error; delayMs: number }
	| { kind: "stopped"; error?: Error };

export type RpcSocketOptions = {
	/** Resolves the socket URL with a fresh ticket. An error with `fatal: true` stops reconnecting. */
	authorize: () => Promise<string>;
	socket: SocketFactory;
	onState: (state: RpcState) => void;
	/** Runs once per opened socket, after live subscriptions were re-sent. */
	onOpen?: () => void;
	random?: () => number;
	now?: () => number;
};

export const PING_INTERVAL_MS = 5_000;
export const SILENCE_TIMEOUT_MS = 15_000;
export const OPEN_TIMEOUT_MS = 15_000;
const STABLE_AFTER_MS = 30_000;
const MAX_DELAY_MS = 300_000;

/** T3 Code's supervisor after `failures` consecutive failures: a random point in the upper half of min(300 s, 1 s · 2^failures). */
export function retryDelayMs(failures: number, random: number): number {
	const ceiling = Math.min(MAX_DELAY_MS, 1_000 * 2 ** failures);
	return Math.round(ceiling / 2 + (ceiling / 2) * random);
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type Subscription = {
	tag: string;
	payload: () => unknown;
	onValue: (value: unknown) => void;
	onEnd?: (error?: Error) => void;
	persistent: boolean;
	id: number | undefined;
};

type Frame =
	| { _tag: "Chunk"; requestId: number; values: unknown[] }
	| { _tag: "Exit"; requestId: number; exit: { _tag: "Success"; value?: unknown } | { _tag: "Failure"; cause: Cause[] } }
	| { _tag: "Pong" }
	| { _tag: "Defect"; defect: unknown };
type Cause = { _tag: "Fail"; error: { _tag?: string; message?: string; cause?: unknown; requiredPermission?: unknown; detail?: unknown; reason?: unknown } } | { _tag: "Die"; defect: unknown } | { _tag: "Interrupt" };

export function causeError(cause: Cause[] | undefined): RpcError {
	const reasons = cause ?? [];
	const fail = reasons.find((reason) => reason._tag === "Fail");
	if (fail?._tag === "Fail") {
		const { _tag, message, requiredPermission, detail, reason: code } = fail.error ?? {};
		// Source control and pull request errors carry their sentence in `detail`, not in a cause.
		const reason = causeReason(fail.error) ?? (typeof detail === "string" && detail.trim() !== "" && detail.length <= 160 ? detail.trim() : undefined);
		return new RpcError(
			_tag ?? "Fail",
			message ?? "T3 Code rejected the request.",
			reason,
			typeof requiredPermission === "string" ? requiredPermission : undefined,
			typeof code === "string" ? code : undefined,
		);
	}
	const die = reasons.find((reason) => reason._tag === "Die");
	if (die?._tag === "Die") {
		const defect = die.defect as { message?: string } | string | undefined;
		return new RpcError("Die", typeof defect === "string" ? defect : (defect?.message ?? "T3 Code failed the request."));
	}
	return new RpcError("Interrupt", "The request was interrupted.");
}

export const isFatal = (error: unknown): boolean => (error as { fatal?: unknown } | null)?.fatal === true;

export class RpcSocket {
	#socket: SocketLike | undefined;
	#open = false;
	#running = false;
	#nextId = 0;
	#failures = 0;
	#openedAt = 0;
	#lastFrameAt = 0;
	#attempt = 0;
	readonly #pending = new Map<number, Pending>();
	readonly #subscriptions = new Set<Subscription>();
	#retryTimer: ReturnType<typeof setTimeout> | undefined;
	#openTimer: ReturnType<typeof setTimeout> | undefined;
	#pingTimer: ReturnType<typeof setInterval> | undefined;
	readonly #random: () => number;
	readonly #now: () => number;

	constructor(private readonly options: RpcSocketOptions) {
		this.#random = options.random ?? Math.random;
		this.#now = options.now ?? Date.now;
	}

	get isOpen(): boolean {
		return this.#open;
	}

	start(): void {
		if (this.#running) return;
		this.#running = true;
		void this.#connect();
	}

	stop(): void {
		this.#running = false;
		this.#attempt += 1;
		clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
		this.#teardown(new RpcError("Disconnected", t("connection.disconnected")));
		this.options.onState({ kind: "stopped" });
	}

	/** Skips the backoff: after a wake from sleep or an explicit retry. */
	wake(): void {
		this.#failures = 0;
		if (!this.#running) return this.start();
		if (this.#retryTimer === undefined) return;
		clearTimeout(this.#retryTimer);
		this.#retryTimer = undefined;
		void this.#connect();
	}

	/** Drops the current socket and reconnects with backoff, keeping persistent subscriptions. */
	drop(error: Error): void {
		if (this.#socket !== undefined) this.#lost(error);
	}

	request<T>(tag: string, payload: unknown): Promise<T> {
		if (!this.#open) return Promise.reject(new RpcError("Disconnected", "Not connected to T3 Code."));
		const id = this.#nextId++;
		const result = new Promise<T>((resolve, reject) => this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject }));
		this.#send({ _tag: "Request", id, tag, payload, headers: [] });
		return result;
	}

	/**
	 * Streams `tag`, calling `onValue` per item. `payload` is re-read for every (re)subscribe, so a resume
	 * cursor can go in it. Persistent subscriptions survive reconnects; others end with `onEnd(error)`.
	 */
	subscribe(
		tag: string,
		payload: () => unknown,
		onValue: (value: unknown) => void,
		options: { persistent?: boolean; onEnd?: (error?: Error) => void } = {},
	): () => void {
		const subscription: Subscription = { tag, payload, onValue, onEnd: options.onEnd, persistent: options.persistent ?? false, id: undefined };
		if (!this.#open && !subscription.persistent) {
			queueMicrotask(() => subscription.onEnd?.(new RpcError("Disconnected", "Not connected to T3 Code.")));
			return () => undefined;
		}
		this.#subscriptions.add(subscription);
		if (this.#open) this.#issue(subscription);
		return () => {
			this.#subscriptions.delete(subscription);
			if (subscription.id !== undefined && this.#open) this.#send({ _tag: "Interrupt", requestId: subscription.id });
			subscription.id = undefined;
		};
	}

	#issue(subscription: Subscription): void {
		subscription.id = this.#nextId++;
		this.#send({ _tag: "Request", id: subscription.id, tag: subscription.tag, payload: subscription.payload(), headers: [] });
	}

	async #connect(): Promise<void> {
		const attempt = ++this.#attempt;
		this.options.onState({ kind: "connecting" });
		let url: string;
		try {
			url = await this.options.authorize();
		} catch (error) {
			if (attempt === this.#attempt) this.#failed(error as Error);
			return;
		}
		if (attempt !== this.#attempt || !this.#running) return;

		const socket = this.options.socket(url);
		this.#socket = socket;
		this.#openTimer = setTimeout(() => this.#lost(new Error(t("connection.noAnswer"))), OPEN_TIMEOUT_MS);
		socket.onopen = () => {
			if (this.#socket !== socket) return;
			clearTimeout(this.#openTimer);
			this.#open = true;
			this.#openedAt = this.#now();
			this.#lastFrameAt = this.#openedAt;
			this.#pingTimer = setInterval(() => this.#keepAlive(), PING_INTERVAL_MS);
			this.options.onState({ kind: "open" });
			for (const subscription of this.#subscriptions) this.#issue(subscription);
			this.options.onOpen?.();
		};
		socket.onmessage = (event) => {
			if (this.#socket === socket) this.#receive(event.data);
		};
		socket.onclose = () => {
			if (this.#socket === socket) this.#lost(new Error(t("connection.closed")));
		};
		socket.onerror = () => {
			if (this.#socket === socket) this.#lost(new Error(t("connection.failed")));
		};
	}

	#keepAlive(): void {
		if (this.#now() - this.#lastFrameAt > SILENCE_TIMEOUT_MS) return this.#lost(new Error(t("connection.silent")));
		this.#send({ _tag: "Ping" });
	}

	#receive(data: unknown): void {
		this.#lastFrameAt = this.#now();
		let parsed: unknown;
		try {
			parsed = JSON.parse(String(data));
		} catch {
			return;
		}
		for (const frame of (Array.isArray(parsed) ? parsed : [parsed]) as Frame[]) this.#handle(frame);
	}

	#handle(frame: Frame): void {
		switch (frame._tag) {
			case "Chunk": {
				const subscription = this.#subscriptionFor(frame.requestId);
				if (subscription === undefined) return;
				try {
					for (const value of frame.values ?? []) subscription.onValue(value);
				} finally {
					if (subscription.id === frame.requestId) this.#send({ _tag: "Ack", requestId: frame.requestId });
				}
				return;
			}
			case "Exit": {
				const pending = this.#pending.get(frame.requestId);
				if (pending !== undefined) {
					this.#pending.delete(frame.requestId);
					if (frame.exit._tag === "Success") pending.resolve(frame.exit.value ?? null);
					else pending.reject(causeError(frame.exit.cause));
					return;
				}
				const subscription = this.#subscriptionFor(frame.requestId);
				if (subscription === undefined) return;
				subscription.id = undefined;
				if (!subscription.persistent) this.#subscriptions.delete(subscription);
				subscription.onEnd?.(frame.exit._tag === "Success" ? undefined : causeError(frame.exit.cause));
				return;
			}
			default:
				return;
		}
	}

	#subscriptionFor(id: number): Subscription | undefined {
		for (const subscription of this.#subscriptions) if (subscription.id === id) return subscription;
		return undefined;
	}

	#send(message: object): void {
		this.#socket?.send(JSON.stringify(message));
	}

	#lost(error: Error): void {
		if (this.#open && this.#now() - this.#openedAt >= STABLE_AFTER_MS) this.#failures = 0;
		this.#teardown(error);
		if (this.#running) this.#failed(error);
	}

	#failed(error: Error): void {
		if (isFatal(error)) {
			this.#running = false;
			this.options.onState({ kind: "stopped", error });
			return;
		}
		this.#failures += 1;
		const delayMs = retryDelayMs(this.#failures, this.#random());
		this.options.onState({ kind: "retrying", error, delayMs });
		this.#retryTimer = setTimeout(() => {
			this.#retryTimer = undefined;
			void this.#connect();
		}, delayMs);
	}

	#teardown(error: Error): void {
		clearTimeout(this.#openTimer);
		clearInterval(this.#pingTimer);
		this.#pingTimer = undefined;
		const socket = this.#socket;
		this.#socket = undefined;
		this.#open = false;
		if (socket !== undefined) {
			socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
			try {
				socket.close();
			} catch {
				// Already closed.
			}
		}
		for (const pending of this.#pending.values()) pending.reject(new RpcError("Disconnected", error.message));
		this.#pending.clear();
		for (const subscription of [...this.#subscriptions]) {
			subscription.id = undefined;
			if (subscription.persistent) continue;
			this.#subscriptions.delete(subscription);
			subscription.onEnd?.(new RpcError("Disconnected", error.message));
		}
	}
}
