import { describe, expect, it } from "vitest";

import { SPECTRUM } from "./render.js";
import { sliderArt, stopX } from "./slider.js";

const svg = (dataUrl: string) => Buffer.from(dataUrl.replace(/^data:image\/svg\+xml;base64,/, ""), "base64").toString("utf8");

describe("sliderArt", () => {
	it("spreads the stops along the track, ends included", () => {
		expect(stopX(0, 5)).toBe(24);
		expect(stopX(4, 5)).toBe(176);
	});

	it("fills to the thread's value with a solid thumb, and shows the previewed one hollow", () => {
		const out = svg(sliderArt({ label: "High", stops: 5, current: 1, preview: 3, ends: ["Quicker", "Deeper"] }));
		expect(out).toContain(`<circle cx="${stopX(1, 5)}" cy="50" r="11" fill="#FFFFFF"/>`);
		expect(out).toContain(`<circle cx="${stopX(3, 5)}" cy="50" r="9.5" fill="#111111" fill-opacity=".55" stroke="#FFFFFF" stroke-width="2.5"/>`);
		expect(out).toContain(">Quicker<");
	});

	it("puts a note in place of the ends, and a gradient paint in the fill", () => {
		const out = svg(sliderArt({ label: "Ultrathink", stops: 6, current: 5, fill: { gradient: SPECTRUM }, ends: ["Quicker", "Deeper"], note: { text: "Press to apply" } }));
		expect(out).toContain(`fill="url(#slider-fill)"`);
		expect(out).toContain(">Press to apply<");
		expect(out).not.toContain(">Quicker<");
	});
});
