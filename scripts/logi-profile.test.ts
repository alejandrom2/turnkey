import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..");
const profiles = join(root, "logi", "TurnkeyPlugin", "src", "package", "profiles");

describe("logi-profile", () => {
	it("regenerates the committed profiles byte for byte", () => {
		const dir = mkdtempSync(join(tmpdir(), "turnkey-profiles-"));
		try {
			execFileSync("node", ["--import", "./scripts/resolve-ts.mjs", "scripts/logi-profile.ts"], { cwd: root, env: { ...process.env, TURNKEY_PROFILE_OUT: dir }, stdio: "pipe" });
			for (const name of ["DefaultProfile72.lp5", "DefaultProfile70.lp5"]) {
				expect(readFileSync(join(dir, name)).equals(readFileSync(join(profiles, name))), name).toBe(true);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
