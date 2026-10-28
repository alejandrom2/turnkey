import { readJson, writeAtomic } from "./files.js";

type Saved = { haptics?: boolean };

/** The Logitech plugin's own settings, which its settings actions change, in one JSON file. */
export class FileSettings {
	#saved: Saved;
	/** Saves share one temp file, so they run one at a time, each writing what's current then. */
	#saving: Promise<void> = Promise.resolve();

	constructor(private readonly path: string) {
		this.#saved = (readJson(path) as Saved | undefined) ?? {};
	}

	get haptics(): boolean {
		return this.#saved.haptics !== false;
	}

	setHaptics(on: boolean): Promise<void> {
		this.#saved = { ...this.#saved, haptics: on };
		this.#saving = this.#saving.catch(() => undefined).then(() => writeAtomic(this.path, JSON.stringify(this.#saved), 0o600));
		return this.#saving;
	}
}
