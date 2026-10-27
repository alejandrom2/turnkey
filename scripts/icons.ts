// Writes the manifest's static images from the runtime glyph set: `node scripts/icons.ts`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COLORS, glyph, type GlyphName } from "../src/core/render.ts";

const root = join(import.meta.dirname, "..", "com.alejandrom2.t3deck.sdPlugin", "imgs");

const ACTIONS: Record<string, GlyphName> = {
	slot: "chat",
	activity: "running",
	stop: "stop",
	send: "send",
	new: "plus",
	organize: "settle",
	"dial-threads": "chat",
	"dial-model": "sliders",
	"dial-prompts": "spark",
	"dial-answer": "question",
};

const svg = (size: number, body: string, background?: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}${body}</svg>`;

const write = (path: string, contents: string) => {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), contents);
};

for (const [name, mark] of Object.entries(ACTIONS)) {
	write(`actions/${name}/icon.svg`, svg(40, glyph(mark, 4, 4, 32, COLORS.text)));
	write(`actions/${name}/key.svg`, svg(144, glyph(mark, 40, 40, 64, COLORS.text), COLORS.key));
}

const logo = (size: number, background?: string) =>
	svg(size, `${glyph("chat", size * 0.18, size * 0.18, size * 0.64, COLORS.text)}`, background);
write("plugin/category-icon.svg", logo(56));
write("plugin/marketplace.svg", logo(288, COLORS.key));
