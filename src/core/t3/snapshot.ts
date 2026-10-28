import type { RpcSocket } from "./rpc.js";

/**
 * One bounded thread snapshot, then unsubscribes: the latest window plus every queued run and its message
 * (threadHistoryPaging.ts). Undefined when the stream ends or stays quiet first.
 */
export function threadSnapshot(rpc: RpcSocket, threadId: string): Promise<unknown> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: unknown) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			unsubscribe();
			resolve(result);
		};
		const timer = setTimeout(() => finish(undefined), 10_000);
		const unsubscribe = rpc.subscribe(
			"orchestration.subscribeThread",
			() => ({ threadId, acceptBoundedSnapshot: true }),
			(value) => {
				const snapshot = value as { kind?: string; projection?: unknown };
				if (snapshot.kind === "snapshot") finish(snapshot.projection);
			},
			{ onEnd: () => finish(undefined) },
		);
	});
}
