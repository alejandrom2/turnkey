import { chmodSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { readJson, writeAtomic } from "./files.js";

const file = () => join(mkdtempSync(join(tmpdir(), "turnkey-logi-")), "data.json");
const aside = (path: string) =>
	readdirSync(join(path, ".."))
		.filter((name) => name.startsWith("data.json.corrupt-"))
		.map((name) => readFileSync(join(path, "..", name), "utf8"));

afterEach(() => {
	vi.restoreAllMocks();
});

describe("readJson", () => {
	it("moves a non-object file aside", () => {
		const path = file();
		writeFileSync(path, "[]");
		expect(readJson(path)).toBeUndefined();
		expect(aside(path)).toEqual(["[]"]);
	});

	it("a save after a corrupt load keeps the corrupt copy", async () => {
		const path = file();
		writeFileSync(path, "{nope");
		expect(readJson(path)).toBeUndefined();
		await writeAtomic(path, "{}");
		expect(aside(path)).toEqual(["{nope"]);
		expect(readFileSync(path, "utf8")).toBe("{}");
	});

	it("a second corrupt file doesn't overwrite the first", () => {
		const path = file();
		const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
		writeFileSync(path, "{first");
		readJson(path);
		now.mockReturnValue(2_000);
		writeFileSync(path, "{second");
		readJson(path);
		expect(aside(path).sort()).toEqual(["{first", "{second"]);
	});

	it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("an unreadable file isn't treated as empty", () => {
		const path = file();
		writeFileSync(path, "{}");
		chmodSync(path, 0o000);
		expect(() => readJson(path)).toThrow();
	});
});

describe("writeAtomic", () => {
	it.skipIf(process.platform === "win32")("creates the file with its mode even over a leftover temp", async () => {
		const path = file();
		writeFileSync(path + ".tmp", "{}", { mode: 0o644 });
		chmodSync(path + ".tmp", 0o644);
		await writeAtomic(path, "{}", 0o600);
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});
});
