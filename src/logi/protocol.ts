/** Lines the Logitech plugin sends: `action` is its action instance's id, `size` the key's pixel width, `language` Logi's id such as "de-DE". */
export type HostMessage =
	| { type: "appear"; action: string; size: number }
	| { type: "disappear"; action: string }
	/** `heldMs` is how long a keypad press was held; none means an Actions Ring click, which is itself the confirmation. */
	| { type: "press"; action: string; heldMs?: number }
	/** A scroll on an adjustment: whole ticks, negative for back. */
	| { type: "turn"; action: string; ticks: number }
	| { type: "language"; language: string };

/** A moment worth a buzz on an MX Master 4; the plugin raises it as a Logi event of the same name. */
export type HapticEvent = "approvalNeeded" | "questionAsked" | "runFinished" | "runFailed";

/** Lines sent back: `svg` is the face's markup, which the plugin draws, and `label` the name it shows for it, if not its own. Log lines are the only way to log, since stdout is the channel. */
export type SidecarMessage =
	| { type: "image"; action: string; svg: string; label?: string }
	| { type: "haptic"; event: HapticEvent }
	/** Logi's banner for the plugin; `url` is a button's target, such as the pairing page. */
	| { type: "status"; level: "normal" | "warning" | "error"; message: string; url?: string; urlTitle?: string }
	| { type: "log"; level: "info" | "warn"; message: string };

const isSize = (size: unknown): size is number => Number.isInteger(size) && (size as number) >= 16 && (size as number) <= 512;

/** Undefined for anything that isn't a well-formed host message: stdin is a trust boundary. */
export function parseHostMessage(line: string): HostMessage | undefined {
	let value: unknown;
	try {
		value = JSON.parse(line);
	} catch {
		return undefined;
	}
	if (typeof value !== "object" || value === null) return undefined;
	const { type, action, size, language, ticks, heldMs } = value as Record<string, unknown>;
	if (type === "language") return typeof language === "string" ? { type, language } : undefined;
	if (typeof action !== "string") return undefined;
	switch (type) {
		case "appear":
			return isSize(size) ? { type, action, size } : undefined;
		case "disappear":
			return { type, action };
		case "press":
			// Only an absent heldMs is a Ring click (confirmed), so a present but bad one reads as a tap, never as a click.
			if (heldMs === undefined) return { type, action };
			return { type, action, heldMs: Number.isInteger(heldMs) ? Math.min(Math.max(heldMs as number, 0), 600000) : 0 };
		case "turn":
			return Number.isInteger(ticks) ? { type, action, ticks: ticks as number } : undefined;
		default:
			return undefined;
	}
}

// JSON.stringify escapes newlines inside strings, so each message is exactly one line.
export const encodeMessage = (message: SidecarMessage): string => `${JSON.stringify(message)}\n`;
