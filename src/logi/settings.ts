import { readJson, writeAtomic } from "./files.js";

type Saved = { haptics?: boolean };

/** The Logitech plugin's own settings, which its settings actions change, in one JSON file. */
export class FileSettings {
	#saved: Saved;

	constructor(private readonly path: string) {
		this.#saved = (readJson(path) as Saved | undefined) ?? {};
	}

	get haptics(): boolean {
		return this.#saved.haptics !== false;
	}

	async setHaptics(on: boolean): Promise<void> {
		this.#saved = { ...this.#saved, haptics: on };
		await writeAtomic(this.path, JSON.stringify(this.#saved), 0o600);
	}
}
