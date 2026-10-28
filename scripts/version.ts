// Writes package.json's version into the Stream Deck manifest (four parts) and the Logitech package: `node scripts/version.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const path = join(root, "com.alejandrom2.turnkey.sdPlugin", "manifest.json");
const manifest = readFileSync(path, "utf8");
const pattern = /^(\t"Version": )"[^"]*"/m;
if (!pattern.test(manifest)) throw new Error(`No top-level "Version" in ${path}`);
const next = manifest.replace(pattern, `$1"${version}.0"`);
if (next !== manifest) writeFileSync(path, next);
console.log(`manifest version ${version}.0`);

const logi = join(root, "logi", "TurnkeyPlugin", "src", "package", "metadata", "LoupedeckPackage.yaml");
const yaml = readFileSync(logi, "utf8");
const line = /^version: .*$/m;
if (!line.test(yaml)) throw new Error(`No "version:" in ${logi}`);
const nextYaml = yaml.replace(line, `version: ${version}`);
if (nextYaml !== yaml) writeFileSync(logi, nextYaml);
console.log(`Logitech package version ${version}`);
