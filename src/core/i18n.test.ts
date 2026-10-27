import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { I18nProvider } from "@elgato/utils/i18n";
import { describe, expect, it } from "vitest";

import { elapsed, formatMessage, htmlLang, messageTable, setTranslator, t } from "./i18n.js";

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

/** Every string leaf of a whole language file (manifest overrides included), by dot path. */
function strings(node: Json, path = "", into = new Map<string, string>()): Map<string, string> {
	if (typeof node === "string") into.set(path, node);
	else for (const [name, child] of Object.entries(node)) strings(child, path ? `${path}.${name}` : name, into);
	return into;
}

const english = strings(en);

describe("other languages", () => {
	const files = readdirSync(plugin).filter((file) => /^[a-z]{2}(_[A-Z]{2})?\.json$/.test(file) && file !== "en.json");

	it("covers every language Stream Deck offers", () => {
		expect(files.map((file) => file.replace(/\.json$/, "")).sort()).toEqual(["de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW"]);
	});

	it.each(files)("%s has exactly English's keys, placeholders and manifest overrides", (file) => {
		const locale = readJson(join(plugin, file));
		leaves(locale.Localization);
		const own = strings(locale);
		expect([...english.keys()].filter((key) => !own.has(key)), `${file}: missing`).toEqual([]);
		expect([...own.keys()].filter((key) => !english.has(key)), `${file}: extra`).toEqual([]);
		for (const [key, text] of own) {
			expect(text.trim(), `${file}: ${key} is empty`).not.toBe("");
			expect(placeholders(text), `${file}: ${key}`).toEqual(placeholders(english.get(key)!));
		}
		for (const action of manifest.Actions) {
			expect(locale[action.UUID]?.Name, `${file}: ${action.UUID}`).toBeTruthy();
			expect(locale[action.UUID]?.Tooltip, `${file}: ${action.UUID}`).toBeTruthy();
		}
	});
});

/** Reads language files the way the SDK's provider does for the plugin process, whose working directory is the plugin. */
const fromPlugin = (language: string) => {
	const path = join(plugin, `${language}.json`);
	return existsSync(path) ? readJson(path).Localization : null;
};

describe("language selection", () => {
	it.each(["de", "es", "fr", "ja", "ko", "zh_CN", "zh_TW"])("a %s Stream Deck draws keys and inspectors in that language", (language) => {
		const locale = readJson(join(plugin, `${language}.json`)).Localization;
		const provider = new I18nProvider(language as "en", fromPlugin);
		try {
			setTranslator((key) => provider.translate(key));
			expect(t("result.sent")).toBe(locale.result.sent);
			expect(t("health.readyCount", { ready: 2, total: 3 })).toBe(formatMessage(locale.health.readyCount, { ready: 2, total: 3 }));
			expect(messageTable("inspector")["inspector.card.connect"]).toBe(locale.inspector.card.connect);
		} finally {
			setTranslator((key) => key);
		}
	});

	it("falls back to English for a language with no file", () => {
		const provider = new I18nProvider("pt" as "en", fromPlugin);
		try {
			setTranslator((key) => provider.translate(key));
			expect(t("result.sent")).toBe(en.Localization.result.sent);
			expect(messageTable("inspector")["inspector.card.connect"]).toBe(en.Localization.inspector.card.connect);
		} finally {
			setTranslator((key) => key);
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

	it("tags inspectors with the HTML form of Stream Deck's language", () => {
		expect(["en", "de", "zh_CN", "zh_TW"].map(htmlLang)).toEqual(["en", "de", "zh-CN", "zh-TW"]);
	});

	it("formats elapsed time", () => {
		expect(elapsed(undefined, 0)).toBe("");
		expect(elapsed(0, 59_999)).toBe("0m");
		expect(elapsed(0, 4 * 60_000 + 5_000)).toBe("4m");
		expect(elapsed(0, 59 * 60_000)).toBe("59m");
		expect(elapsed(0, 90 * 60_000)).toBe("1.5h");
		expect(elapsed(0, 2 * 3_600_000)).toBe("2h");
		expect(elapsed(0, 47 * 3_600_000)).toBe("47h");
		expect(elapsed(0, 60 * 3_600_000)).toBe("2.5d");
	});
});
