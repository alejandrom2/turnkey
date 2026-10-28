import { mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import type { Credential } from "../core/t3/pairing.js";
import { FileCredentials } from "./store.js";

const credential: Credential = { token: "secret", expiresAt: 1, scopes: ["orchestration:read"], label: "Studio", environmentId: "env" };
const file = () => join(mkdtempSync(join(tmpdir(), "turnkey-logi-")), "credentials.json");

describe("FileCredentials", () => {
	it("round-trips a credential", async () => {
		const path = file();
		await new FileCredentials(path).save("http://localhost:3773", credential);
		expect(new FileCredentials(path).load("http://localhost:3773")).toEqual(credential);
	});

	it("lists the machines it has tokens for", async () => {
		const path = file();
		const store = new FileCredentials(path);
		await store.save("http://a", credential);
		await store.save("http://b", credential);
		expect(new FileCredentials(path).urls()).toEqual(["http://a", "http://b"]);
	});

	it("forgets a credential saved as undefined", async () => {
		const path = file();
		const store = new FileCredentials(path);
		await store.save("http://a", credential);
		await store.save("http://a", undefined);
		expect(new FileCredentials(path).load("http://a")).toBeUndefined();
	});

	it.skipIf(process.platform === "win32")("writes the file owner-only", async () => {
		const path = file();
		await new FileCredentials(path).save("http://a", credential);
		expect(statSync(path).mode & 0o777).toBe(0o600);
	});

	it("treats a missing or corrupt file as empty", () => {
		expect(new FileCredentials(file()).load("http://a")).toBeUndefined();
		const corrupt = file();
		writeFileSync(corrupt, "{nope");
		expect(new FileCredentials(corrupt).load("http://a")).toBeUndefined();
	});
});
