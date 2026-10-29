/** Review's clock, read when the key is pressed: the module would otherwise keep the real `Date.now` from before fake timers. */
export function withLiveClock<M extends { Reviews: new (ended: (owner: string) => void, now?: () => number) => object }>(module: M): M {
	class Reviews extends module.Reviews {
		constructor(ended: (owner: string) => void) {
			super(ended, () => Date.now());
		}
	}
	return { ...module, Reviews };
}
