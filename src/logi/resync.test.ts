import { expect, it } from "vitest";

import { throttled } from "./resync.js";

it("resyncs at most once per 10 s", () => {
	let clock = 0;
	let runs = 0;
	const resync = throttled(() => runs++, 10_000, () => clock);
	for (const at of [0, 1_000, 9_000]) {
		clock = at;
		resync();
	}
	expect(runs).toBe(1);
	clock = 10_000;
	resync();
	expect(runs).toBe(2);
});
