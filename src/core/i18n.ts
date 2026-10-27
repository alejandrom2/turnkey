import en from "../../com.alejandrom2.t3deck.sdPlugin/en.json";

/**
 * Keys are dot paths into en.json's nested "Localization" object, because the SDK's I18nProvider resolves them with
 * @elgato/utils' `get()`, which splits on "." (so English sentences can't be keys). Values take `{name}` placeholders.
 */
type Leaves<T, Prefix extends string = ""> = {
	[K in keyof T & string]: T[K] extends string ? `${Prefix}${K}` : Leaves<T[K], `${Prefix}${K}.`>;
}[keyof T & string];

export type MessageKey = Leaves<typeof en.Localization>;
export type MessageParams = Record<string, string | number>;

const english = (key: string): string | undefined => {
	const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], en.Localization);
	return typeof value === "string" ? value : undefined;
};

let translate = (key: string): string => english(key) ?? key;

/** Plugs in the SDK's translator once it connects; until then, and in tests, strings are English. */
export function setTranslator(translator: (key: string) => string): void {
	translate = translator;
}

export const formatMessage = (text: string, params: MessageParams): string =>
	text.replace(/\{(\w+)\}/g, (placeholder, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : placeholder));

/** The current language's text for `key`, else English; call it when drawing, never at module load. */
export function t(key: MessageKey, params?: MessageParams): string {
	const found = translate(key);
	// The SDK's provider answers with the key itself when no language file has it.
	const text = found === key ? (english(key) ?? key) : found;
	return params === undefined ? text : formatMessage(text, params);
}

/** Every key under `prefix`, translated: what a property inspector applies over its English text. */
export function messageTable(prefix: string): Record<string, string> {
	const table: Record<string, string> = {};
	const walk = (node: unknown, path: string): void => {
		if (typeof node === "string") {
			if (path === prefix || path.startsWith(`${prefix}.`)) table[path] = t(path as MessageKey);
			return;
		}
		for (const [name, child] of Object.entries(node as Record<string, unknown>)) walk(child, path ? `${path}.${name}` : name);
	};
	walk(en.Localization, "");
	return table;
}

/** Stream Deck's language code as an HTML `lang` tag (`zh_CN` → `zh-CN`), so inspectors pick the right CJK glyphs. */
export const htmlLang = (language: string): string => language.replace("_", "-");

/** One decimal under ten (`1.5`, `2`), whole numbers above. */
const short = (value: number): string => (value < 10 ? String(Math.round(value * 10) / 10) : String(Math.round(value)));

/** A running turn's elapsed time, coarse like T3 Code's sidebar: `4m`, `1.5h` (under two days), `2d`. */
export const elapsed = (since: number | undefined, now: number): string => {
	if (since === undefined) return "";
	const minutes = Math.floor(Math.max(0, now - since) / 60_000);
	if (minutes < 60) return t("time.minutes", { minutes });
	const hours = Math.floor(minutes / 6) / 10;
	if (hours < 48) return t("time.hours", { hours: short(hours) });
	return t("time.days", { days: short(Math.floor(hours / 2.4) / 10) });
};
