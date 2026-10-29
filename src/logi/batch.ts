/** Machine updates arrive in bursts: `work` runs once per burst, and a throw is reported instead of killing the sidecar. */
export function batched(work: () => void, onError: (error: unknown) => void): () => void {
	let queued = false;
	return () => {
		if (queued) return;
		queued = true;
		queueMicrotask(() => {
			queued = false;
			try {
				work();
			} catch (error) {
				onError(error);
			}
		});
	};
}
