import { describe, expect, it } from "vitest";

import { setCapped } from "./capped.js";

describe("setCapped", () => {
	it("drops the oldest key only when a new key would pass the cap", () => {
		const map = new Map([["a", 1], ["b", 2]]);
		setCapped(map, "b", 3, 2);
		expect([...map]).toEqual([["a", 1], ["b", 3]]);
		setCapped(map, "c", 4, 2);
		expect([...map]).toEqual([["b", 3], ["c", 4]]);
	});
});
