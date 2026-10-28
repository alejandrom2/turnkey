import { describe, expect, it } from "vitest";

import { batched } from "./batch.js";

describe("batched", () => {
	it("runs a burst once", async () => {
		let runs = 0;
		const trigger = batched(() => runs++, () => undefined);
		trigger();
		trigger();
		trigger();
		await Promise.resolve();
		expect(runs).toBe(1);
		trigger();
		await Promise.resolve();
		expect(runs).toBe(2);
	});

	it("reports a throw instead of raising it", async () => {
		const errors: unknown[] = [];
		const trigger = batched(() => {
			throw new Error("bad face");
		}, (error) => errors.push(error));
		trigger();
		await Promise.resolve();
		expect(errors).toEqual([new Error("bad face")]);
	});
});
