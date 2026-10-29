import en from "../../com.alejandrom2.turnkey.sdPlugin/en.json";
import de from "../../com.alejandrom2.turnkey.sdPlugin/de.json";
import es from "../../com.alejandrom2.turnkey.sdPlugin/es.json";
import fr from "../../com.alejandrom2.turnkey.sdPlugin/fr.json";
import ja from "../../com.alejandrom2.turnkey.sdPlugin/ja.json";
import ko from "../../com.alejandrom2.turnkey.sdPlugin/ko.json";
import zhCN from "../../com.alejandrom2.turnkey.sdPlugin/zh_CN.json";
import zhTW from "../../com.alejandrom2.turnkey.sdPlugin/zh_TW.json";
import { setTranslator } from "../core/i18n.js";

/** Turnkey's translations by Logi's language id; Chinese is told apart by region, the rest by language. */
const TABLES: Record<string, { Localization: unknown }> = { de, es, fr, ja, ko, "zh-CN": zhCN, "zh-TW": zhTW };

const lookup = (table: unknown, key: string): string | undefined => {
	const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], table);
	return typeof value === "string" ? value : undefined;
};

let manifest: Record<string, unknown> = en;

/** Speaks the plugin's language from here on; English, and any language Turnkey lacks, fall back to en.json. */
export function useLanguage(language: string): void {
	const table = TABLES[language] ?? TABLES[language.split("-")[0]!];
	manifest = table ?? en;
	// t() falls back to English when the translator hands back the key itself.
	setTranslator((key) => (table ? (lookup(table.Localization, key) ?? key) : key));
}

/** The manifest's name for an action, such as "health" for Health, in the language in use. */
export function actionName(action: string): string {
	const read = (from: Record<string, unknown>) => (from[`com.alejandrom2.turnkey.${action}`] as { Name?: string } | undefined)?.Name;
	return read(manifest) ?? read(en) ?? action;
}
