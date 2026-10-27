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

/** A running turn's elapsed time: `m:ss`, or `h` + `mm` past an hour. */
export const elapsed = (since: number | undefined, now: number): string => {
	if (since === undefined) return "";
	const seconds = Math.max(0, Math.floor((now - since) / 1000));
	const minutes = Math.floor(seconds / 60);
	return minutes >= 60
		? t("time.hours", { hours: Math.floor(minutes / 60), minutes: String(minutes % 60).padStart(2, "0") })
		: t("time.minutes", { minutes, seconds: String(seconds % 60).padStart(2, "0") });
};
