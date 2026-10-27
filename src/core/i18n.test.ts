import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { elapsed, formatMessage, messageTable, setTranslator, t } from "./i18n.js";

type Json = { [key: string]: Json } | string;

const root = join(import.meta.dirname, "..", "..");
const plugin = join(root, "com.alejandrom2.t3deck.sdPlugin");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

const en = readJson(join(plugin, "en.json"));
const manifest = readJson(join(plugin, "manifest.json"));

/** Every leaf of a Localization table by its dot path; non-strings and empty strings are errors the provider would hide. */
function leaves(node: Json, path = "", into = new Map<string, string>()): Map<string, string> {
	if (typeof node === "string") {
		if (node === "") throw new Error(`Localization.${path} is empty: the SDK treats "" as missing`);
		into.set(path, node);
	} else if (node !== null && typeof node === "object") {
		for (const [name, child] of Object.entries(node)) {
			if (name.includes(".")) throw new Error(`Localization.${path}.${name}: keys can't contain "."`);
			leaves(child, path ? `${path}.${name}` : name, into);
		}
	} else {
		throw new Error(`Localization.${path} is not a string`);
	}
	return into;
}

const keys = leaves(en.Localization);
const namespaces = new Set(Object.keys(en.Localization));

/** Plugin code and the inspector generator; keys are always written as whole literals, never built. */
const sources = [
	...readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
		.map((file) => readFileSync(join(root, "src", file), "utf8")),
	readFileSync(join(root, "scripts", "ui.ts"), "utf8"),
].join("\n");
const referenced = new Set(
	[...sources.matchAll(/["'`]([A-Za-z]+(?:\.[A-Za-z0-9]+)+)["'`]/g)].map((match) => match[1]!).filter((key) => namespaces.has(key.split(".")[0]!) && !/\.(ts|js|json|html)$/.test(key)),
);

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("en.json", () => {
	it("has every key the code names", () => {
		expect([...referenced].filter((key) => !keys.has(key))).toEqual([]);
	});

	it("has no key the code doesn't name", () => {
		expect([...keys.keys()].filter((key) => !referenced.has(key))).toEqual([]);
	});

	it("overrides the manifest with its own words", () => {
		expect({ Name: en.Name, Description: en.Description, Category: en.Category }).toEqual({
			Name: manifest.Name,
			Description: manifest.Description,
			Category: manifest.Category,
		});
		for (const action of manifest.Actions) {
			const expected: Record<string, unknown> = { Name: action.Name, Tooltip: action.Tooltip };
			if (action.Encoder?.TriggerDescription) expected.Encoder = { TriggerDescription: action.Encoder.TriggerDescription };
			expect(en[action.UUID], action.UUID).toEqual(expected);
		}
		const actions = new Set(manifest.Actions.map((action: { UUID: string }) => action.UUID));
		expect(Object.keys(en).filter((key) => !["Name", "Description", "Category", "Localization"].includes(key) && !actions.has(key))).toEqual([]);
	});
});

describe("other languages", () => {
	const files = readdirSync(plugin).filter((file) => /^[a-z]{2}(_[A-Z]{2})?\.json$/.test(file) && file !== "en.json");

	it.each(files.length > 0 ? files : ["(none yet)"])("%s keeps to English's keys and placeholders", (file) => {
		if (file === "(none yet)") return;
		const locale = readJson(join(plugin, file));
		const actions = new Set(manifest.Actions.map((action: { UUID: string }) => action.UUID));
		expect(Object.keys(locale).filter((key) => !["Name", "Description", "Category", "Localization"].includes(key) && !actions.has(key))).toEqual([]);
		for (const [key, text] of leaves(locale.Localization ?? {})) {
			expect(keys.has(key), `${file}: unknown key ${key}`).toBe(true);
			expect(placeholders(text), `${file}: ${key}`).toEqual(placeholders(keys.get(key)!));
		}
	});
});

describe("t", () => {
	it("fills placeholders and leaves unknown ones", () => {
		expect(t("health.readyCount", { ready: 2, total: 3 })).toBe("2 of 3 ready");
		expect(formatMessage("{a} and {b}", { a: 1 })).toBe("1 and {b}");
	});

	it("uses the injected translator, falling back to English when it only echoes the key", () => {
		try {
			setTranslator((key) => (key === "result.sent" ? "Gesendet" : key));
			expect(t("result.sent")).toBe("Gesendet");
			expect(t("result.opened")).toBe("Opened");
			expect(messageTable("inspector")["inspector.card.connect"]).toBe("Connect");
		} finally {
			setTranslator((key) => key);
		}
	});

	it("gives inspectors only their own keys", () => {
		const table = messageTable("inspector");
		expect(Object.keys(table).every((key) => key.startsWith("inspector."))).toBe(true);
		expect(Object.keys(table)).toHaveLength([...keys.keys()].filter((key) => key.startsWith("inspector.")).length);
	});

	it("formats elapsed time", () => {
		expect(elapsed(undefined, 0)).toBe("");
		expect(elapsed(0, 65_000)).toBe("1:05");
		expect(elapsed(0, 3_725_000)).toBe("1h02");
	});
});
