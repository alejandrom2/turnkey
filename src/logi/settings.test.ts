import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { FileSettings } from "./settings.js";

const file = () => join(mkdtempSync(join(tmpdir(), "turnkey-logi-")), "settings.json");

describe("FileSettings", () => {
	it("has haptics on until turned off, and remembers it", async () => {
		const path = file();
		const settings = new FileSettings(path);
		expect(settings.haptics).toBe(true);
		await settings.setHaptics(false);
		expect(new FileSettings(path).haptics).toBe(false);
	});

	it("saves that overlap all land, and the file holds the last", async () => {
		const path = file();
		const settings = new FileSettings(path);
		await Promise.all([settings.setHaptics(false), settings.setHaptics(true), settings.setHaptics(false)]);
		expect(new FileSettings(path).haptics).toBe(false);
	});

	it("treats a corrupt file as the defaults", () => {
		const path = file();
		writeFileSync(path, "{nope");
		expect(new FileSettings(path).haptics).toBe(true);
	});

	it("keeps a corrupt file aside", () => {
		const path = file();
		writeFileSync(path, "{nope");
		new FileSettings(path);
		expect(readFileSync(path + ".corrupt", "utf8")).toBe("{nope");
		expect(existsSync(path)).toBe(false);
	});
});
