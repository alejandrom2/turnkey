/** Runs `work` on demand, never more than once per `gapMs`. */
export function throttled(work: () => void, gapMs: number, now: () => number = Date.now): () => void {
	let last = -Infinity;
	return () => {
		if (now() - last < gapMs) return;
		last = now();
		work();
	};
}
