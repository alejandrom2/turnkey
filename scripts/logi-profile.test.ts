import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

	it("names only actions that exist as C# classes", () => {
		const names = new Set<string>();
		for (const file of ["DefaultProfile72.lp5", "DefaultProfile70.lp5"]) {
			// Entries are stored uncompressed, so the profile JSON is readable straight from the zip.
			const text = readFileSync(join(profiles, file)).toString("utf8");
			for (const [, name] of text.matchAll(/"(?:pressAction|rotateAction)": "(\$Turnkey___[^"]+)"/g)) names.add(name);
		}
		expect(names.size).toBeGreaterThan(8);
		for (const name of names) {
			const klass = /^\$Turnkey___(?:#DynamicFolder___DynamicFolder#)?Loupedeck\.TurnkeyPlugin\.(\w+)$/.exec(name)?.[1];
			expect(klass, name).toBeDefined();
			const file = join(root, "logi", "TurnkeyPlugin", "src", "Actions", `${klass}.cs`);
			expect(existsSync(file), name).toBe(true);
			// Options+ names a plugin's dynamic folder by its type, not like a command.
			expect(name.includes("#DynamicFolder___"), name).toBe(readFileSync(file, "utf8").includes(": PluginDynamicFolder"));
		}
	});
});
