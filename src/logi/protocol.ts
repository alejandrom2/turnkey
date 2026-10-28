/** Lines the Logitech plugin sends: `action` is its action instance's id, `size` the key's pixel width, `language` Logi's id such as "de-DE". */
export type HostMessage =
	| { type: "appear"; action: string; size: number }
	| { type: "disappear"; action: string }
	| { type: "press"; action: string }
	| { type: "language"; language: string };

/** A moment worth a buzz on an MX Master 4; the plugin raises it as a Logi event of the same name. */
export type HapticEvent = "approvalNeeded" | "questionAsked" | "runFinished" | "runFailed";

/** Lines sent back: `svg` is the face's markup, which the plugin draws. Log lines are the only way to log, since stdout is the channel. */
export type SidecarMessage =
	| { type: "image"; action: string; svg: string }
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
	const { type, action, size, language } = value as Record<string, unknown>;
	if (type === "language") return typeof language === "string" ? { type, language } : undefined;
	if (typeof action !== "string") return undefined;
	switch (type) {
		case "appear":
			return isSize(size) ? { type, action, size } : undefined;
		case "disappear":
		case "press":
			return { type, action };
		default:
			return undefined;
	}
}

// JSON.stringify escapes newlines inside strings, so each message is exactly one line.
export const encodeMessage = (message: SidecarMessage): string => `${JSON.stringify(message)}\n`;
