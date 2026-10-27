/**
 * Claude's Ultrathink, as T3 Code does it: a prompt-injected effort value that prefixes the prompt and is never sent
 * as a model option (packages/shared/src/model.ts `applyClaudePromptEffortPrefix`). The deck arms it per thread in
 * memory; the thread's real effort stays as it is.
 */
import { type CatalogModel, effortOption } from "./models.js";

export const ULTRATHINK = "ultrathink";

/** `applyClaudePromptEffortPrefix`: trimmed, and left alone when empty, a slash command or already prefixed. */
export function applyPromptEffortPrefix(text: string, effort: string | undefined): string {
	const trimmed = text.trim();
	if (!trimmed || effort !== ULTRATHINK || /^\/[^\s/]+(?:\s|$)/u.test(trimmed) || trimmed.startsWith("Ultrathink:")) return trimmed;
	return `Ultrathink:\n${trimmed}`;
}

/** The prompt-injected values on a model's effort option. */
export const ultrathinkValues = (model: Pick<CatalogModel, "options"> | undefined): { value: string; label: string }[] => effortOption(model)?.injected ?? [];

export const offersUltrathink = (model: Pick<CatalogModel, "options"> | undefined): boolean => ultrathinkValues(model).some((choice) => choice.value === ULTRATHINK);

/** Which threads (by key) have Ultrathink armed; it lasts until effort moves away or the thread's model drops it. */
export class UltrathinkArming {
	readonly #armed = new Set<string>();

	constructor(private readonly onChange: () => void = () => undefined) {}

	arm(key: string): void {
		if (this.#armed.has(key)) return;
		this.#armed.add(key);
		this.onChange();
	}

	disarm(key: string): void {
		if (this.#armed.delete(key)) this.onChange();
	}

	/** Armed for `key` while `model` offers Ultrathink; a known model without it disarms. Unknown (config not loaded) keeps it. */
	armed(key: string | undefined, model: Pick<CatalogModel, "options"> | undefined): boolean {
		if (key === undefined || !this.#armed.has(key)) return false;
		if (model === undefined || offersUltrathink(model)) return true;
		this.#armed.delete(key);
		return false;
	}

	/** The text the deck sends to `key`'s thread. */
	prompt(key: string, model: Pick<CatalogModel, "options"> | undefined, text: string): string {
		return this.armed(key, model) ? applyPromptEffortPrefix(text, ULTRATHINK) : text;
	}
}
