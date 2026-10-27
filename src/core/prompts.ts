import { type MessageKey, t } from "./i18n.js";

/**
 * Quick Prompt's templates, after Elgato's prompt key, plus T3 Code's commit step. Only labels are localized: the
 * text goes to the agent, and the Prompts dial matches it against the user's own lines.
 */
export const QUICK_PROMPTS = {
	continue: { label: "quick.continue", text: "Continue." },
	test: { label: "quick.test", text: "Run the tests and fix any failures." },
	fix: { label: "quick.fix", text: "Diagnose the problem and fix it." },
	explain: { label: "quick.explain", text: "Explain the current state of the work: what's done, what's left, and anything blocking it." },
	commit: { label: "quick.commit", text: "Commit your changes with a clear message." },
} as const satisfies Record<string, { label: MessageKey; text: string }>;

export type QuickTemplate = keyof typeof QUICK_PROMPTS | "custom";

export const quickTemplate = (value: unknown): QuickTemplate =>
	typeof value === "string" && (value === "custom" || Object.hasOwn(QUICK_PROMPTS, value)) ? (value as QuickTemplate) : "continue";

/** The prompt a Quick Prompt key sends and the label it shows unless it has a title. */
export function quickPrompt(settings: { template?: unknown; prompt?: unknown }): { text: string; label: string } {
	const template = quickTemplate(settings.template);
	if (template === "custom") return { text: typeof settings.prompt === "string" ? settings.prompt.trim() : "", label: t("face.prompt") };
	const { label, text } = QUICK_PROMPTS[template];
	return { text, label: t(label) };
}

/**
 * Send Prompt's key label moved from `label` to `title`, like Elgato's key title. Returns the settings to save
 * once, or undefined when there is nothing to migrate; a title set since wins.
 */
export function migratePromptSettings<T extends { title?: unknown; label?: unknown }>(settings: T): Omit<T, "label"> | undefined {
	if (!("label" in settings)) return undefined;
	const { label, ...rest } = settings;
	const title = typeof rest.title === "string" && rest.title !== "" ? rest.title : label;
	return typeof title === "string" && title !== "" ? { ...rest, title } : rest;
}

export type DialPrompt = { text: string; label?: string };

const sameText = (text: string) => text.trim().toLowerCase().replace(/[.!\s]+$/, "");

/** The Prompts dial's list: the user's own lines, then Quick Prompt's templates (unless turned off) not already among them. */
export function dialPrompts(settings: { prompts?: unknown; templates?: unknown }): DialPrompt[] {
	const own = (typeof settings.prompts === "string" ? settings.prompts : "")
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((text): DialPrompt => ({ text }));
	if (settings.templates === false || settings.templates === "false") return own;
	const seen = new Set(own.map((prompt) => sameText(prompt.text)));
	return [...own, ...Object.values(QUICK_PROMPTS).filter((template) => !seen.has(sameText(template.text))).map((template) => ({ text: template.text, label: t(template.label) }))];
}
