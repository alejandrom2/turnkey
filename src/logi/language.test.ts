import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { t } from "../core/i18n.js";
import { useLanguage } from "./language.js";

const table = (file: string) => JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "com.alejandrom2.turnkey.sdPlugin", `${file}.json`), "utf8")).Localization;

afterEach(() => useLanguage("en-US"));

describe("useLanguage", () => {
	it("speaks the plugin's language, by Logi's language id", () => {
		useLanguage("de-DE");
		expect(t("needs.paired")).toBe(table("de").needs.paired);
		useLanguage("zh-TW");
		expect(t("needs.paired")).toBe(table("zh_TW").needs.paired);
		useLanguage("zh-CN");
		expect(t("needs.paired")).toBe(table("zh_CN").needs.paired);
	});

	it("falls back to English for a language Turnkey doesn't speak", () => {
		useLanguage("ja-JP");
		useLanguage("pt-BR");
		expect(t("needs.paired")).toBe("Paired with T3 Code");
	});
});
