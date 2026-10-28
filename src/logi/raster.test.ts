import { describe, expect, it } from "vitest";

import { renderResultKey } from "../core/render.js";
import { keyPng } from "./raster.js";

describe("keyPng", () => {
	it("draws a key at the device's size", () => {
		const png = Buffer.from(keyPng(renderResultKey({ ok: true, label: "Done" }), 80), "base64");
		expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
		// IHDR: width then height, big-endian, after the 8-byte signature and the chunk's length and type.
		expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([80, 80]);
	});

	it("draws text", () => {
		expect(keyPng(renderResultKey({ ok: true, label: "Done" }), 80)).not.toBe(keyPng(renderResultKey({ ok: true, label: "" }), 80));
	});
});
