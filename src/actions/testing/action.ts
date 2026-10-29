let next = 0;
const PREFIX = "data:image/svg+xml;base64,";

/** A key as the SDK hands it to an action: records what the action draws, so tests can read it back. */
export class FakeAction {
	readonly id = `fake-${next++}`;
	readonly device = { id: "device" };
	readonly coordinates = { row: 0, column: 0 };
	readonly images: string[] = [];
	alerts = 0;
	/** Image and alert writes in order, so a press record shows what came first. */
	readonly writes: string[] = [];
	readonly settings: unknown[] = [];

	isKey = () => true;
	isDial = () => false;
	isNeoInfobar = () => false;

	async setImage(image: string): Promise<void> {
		// Goldens read as SVG, not as the data URI the SDK takes.
		const svg = image.startsWith(PREFIX) ? Buffer.from(image.slice(PREFIX.length), "base64").toString() : image;
		this.images.push(svg);
		this.writes.push(`setImage ${svg}`);
	}

	async showAlert(): Promise<void> {
		this.alerts++;
		this.writes.push("showAlert");
	}

	async setTitle(): Promise<void> {}
	async setFeedback(): Promise<void> {}

	async setSettings(settings: unknown): Promise<void> {
		this.settings.push(settings);
	}
}
