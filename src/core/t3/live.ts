import type { RpcSocket } from "./rpc.js";

/** How long a shared subscription (config, tasks, terminals) outlives its last watcher, so flipping pages doesn't resubscribe. */
const WATCH_LINGER_MS = 60_000;

/**
 * A stream something on the deck holds open; `rpc` is the connection it runs on, `ended` one that ended it.
 * `scope` keeps it closed on a pairing without that scope.
 */
type LiveWatch = {
	tag: string;
	payload: unknown;
	onValue: (value: unknown) => void;
	onOpen?: () => void;
	onEnd?: (error?: Error) => void;
	scope?: string;
	rpc?: RpcSocket;
	ended?: RpcSocket;
	stop?: () => void;
};

/** The streams the deck holds open on one machine, kept on whichever connection `socketFor` names. */
export class LiveWatches {
	readonly #watches = new Set<LiveWatch>();

	/** `socketFor` answers the connection a watch under `scope` runs on now, or undefined to keep it closed. */
	constructor(private readonly socketFor: (scope: string | undefined) => RpcSocket | undefined) {}

	/**
	 * Keeps a stream open while held: on the current connection, again on the next one (`onOpen` runs first, so the
	 * holder can drop what it cached), never while offline. A stream T3 Code ends waits for the next connection.
	 */
	hold(watch: LiveWatch): () => void {
		this.#watches.add(watch);
		this.sync();
		return () => {
			this.#watches.delete(watch);
			watch.stop?.();
		};
	}

	/**
	 * One subscription however many hold it, kept by `hold()` (so an ended one waits for the next connection), and
	 * closed a minute after the last release.
	 */
	shared(watch: Pick<LiveWatch, "tag" | "payload" | "onValue" | "onEnd" | "scope">): () => () => void {
		let holders = 0;
		let close: (() => void) | undefined;
		let linger: ReturnType<typeof setTimeout> | undefined;
		return () => {
			holders++;
			clearTimeout(linger);
			close ??= this.hold({ ...watch });
			let released = false;
			return () => {
				if (released) return;
				released = true;
				if (--holders > 0) return;
				linger = setTimeout(() => {
					close?.();
					close = undefined;
				}, WATCH_LINGER_MS);
			};
		};
	}

	/** Moves every watch onto the connection it should run on now; call whenever the connection or its state changes. */
	sync(): void {
		for (const watch of this.#watches) {
			const rpc = this.socketFor(watch.scope);
			if (watch.rpc === rpc && (watch.stop !== undefined || watch.ended === rpc)) continue;
			watch.stop?.();
			watch.stop = undefined;
			watch.rpc = rpc;
			// The socket object outlives a reconnect, so an ended stream is retried once the connection drops.
			if (rpc === undefined) watch.ended = undefined;
			if (rpc === undefined || watch.ended === rpc) continue;
			watch.onOpen?.();
			watch.stop = rpc.subscribe(watch.tag, () => watch.payload, watch.onValue, {
				persistent: true,
				onEnd: (error) => {
					if (watch.rpc !== rpc) return;
					watch.stop?.();
					watch.stop = undefined;
					watch.ended = rpc;
					watch.onEnd?.(error);
				},
			});
		}
	}
}
