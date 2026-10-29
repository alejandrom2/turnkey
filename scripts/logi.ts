// Writes the Logitech plugin's translations from the language files: `node scripts/logi.ts`.
// logi/TurnkeyPlugin/localization/Turnkey.xliff is Logi's English template, keyed by each action's English text: after
// changing that text in C#, regenerate it with Logi Plugin Service running, `logiplugintool xliff Turnkey <dir>`, and drop its <header>.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const plugin = join(root, "com.alejandrom2.turnkey.sdPlugin");
const logi = join(root, "logi", "TurnkeyPlugin");

/** Every string the Logitech plugin shows that Logi translates, as whole keys so the i18n test sees them used. */
const KEYS = [
	"logi.actions.urgent.name",
	"logi.actions.urgent.description",
	"logi.actions.stop.name",
	"logi.actions.stop.description",
	"inspector.settings.title",
	"logi.actions.settings.description",
	"quick.continue",
	"logi.actions.continue.description",
	"logi.actions.status.name",
	"logi.actions.status.description",
	"logi.actions.waiting.name",
	"logi.actions.waiting.description",
	"logi.actions.running.name",
	"logi.actions.running.description",
	"logi.actions.stopAll.name",
	"logi.actions.stopAll.description",
	"limits.title",
	"logi.actions.limits.description",
	"logi.actions.limit.slot1",
	"logi.actions.limit.slot2",
	"logi.actions.limit.slot3",
	"logi.actions.limit.slot4",
	"logi.actions.limit.slot5",
	"logi.actions.limit.description",
	"quick.test",
	"quick.fix",
	"quick.explain",
	"quick.commit",
	"logi.actions.prompt.description",
	"logi.actions.send.name",
	"logi.actions.send.description",
	"face.access",
	"logi.actions.access.description",
	"face.effort",
	"logi.actions.effort.description",
	"usage.title",
	"strip.prompts",
	"face.model",
	"logi.actions.model.slot1",
	"logi.actions.model.slot2",
	"logi.actions.model.slot3",
	"logi.actions.model.slot4",
	"logi.actions.model.slot5",
	"logi.actions.model.description",
	"logi.actions.folder.name",
	"logi.actions.folder.description",
	"logi.actions.group.threads",
	"logi.actions.group.settings",
] as const;

/** Turnkey's language files by Logi's language id. */
const LANGUAGES = { "de-DE": "de", "es-ES": "es", "fr-FR": "fr", "ja-JP": "ja", "ko-KR": "ko", "zh-CN": "zh_CN", "zh-TW": "zh_TW" } as const;

type Table = { Localization: Record<string, unknown> };
const read = (file: string): Table => JSON.parse(readFileSync(join(plugin, `${file}.json`), "utf8")) as Table;
const lookup = (table: Table, key: string): string => {
	const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], table.Localization);
	if (typeof value !== "string") throw new Error(`No string at ${key}`);
	return value;
};
const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&apos;": "'" };
const unescape = (text: string) => text.replace(/&(lt|gt|amp|quot|apos);/g, (entity) => ENTITIES[entity]!);
const escape = (text: string) => text.replace(/[<>&"']/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]!);

const template = readFileSync(join(logi, "localization", "Turnkey.xliff"), "utf8");
const english = read("en");
const keyOf = new Map(KEYS.map((key) => [lookup(english, key), key]));
const unit = /(\s*)<trans-unit id="([^"]+)" translate="yes">\s*<source>([\s\S]*?)<\/source>\s*<target \/>\s*<\/trans-unit>/g;

/** Logi's own units (Reset %, Main, Dynamic Folder, its Dynamic Folders group): left out, so it keeps its own words for them. */
const LOGI_SOURCES = new Set(["Dynamic Folders"]);
const logis = (id: string, source = "") => /___(General___|ModeName___)|___#DynamicFolder"?$/.test(id) || LOGI_SOURCES.has(unescape(source));
const ours = [...template.matchAll(unit)].filter(([, , id, source]) => !logis(id!, source));
const sources = new Set(ours.map(([, , , source]) => unescape(source!)));
for (const source of sources) if (!keyOf.has(source)) throw new Error(`"${source}" is in the template but in no logi.actions key of en.json`);
for (const [text, key] of keyOf) if (!sources.has(text)) throw new Error(`${key} ("${text}") isn't in the template: regenerate it`);

const out = join(logi, "src", "package", "localization");
mkdirSync(out, { recursive: true });
for (const [language, file] of Object.entries(LANGUAGES)) {
	const table = read(file);
	const xliff = template.replace(/target-language=""/g, `target-language="${language}"`).replace(unit, (match, indent: string, id: string, source: string) => {
		const key = keyOf.get(unescape(source));
		if (key === undefined || logis(id, source)) return "";
		return `${indent}<trans-unit id="${id}" translate="yes">${indent}  <source>${source}</source>${indent}  <target>${escape(lookup(table, key))}</target>${indent}</trans-unit>`;
	});
	writeFileSync(join(out, `Turnkey_${language}.xliff`), xliff);
}
console.log(`Logitech translations: ${Object.keys(LANGUAGES).length} languages, ${KEYS.length} strings`);
