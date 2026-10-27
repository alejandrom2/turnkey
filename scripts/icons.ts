// Writes the manifest's static images from the runtime glyph set: `node scripts/icons.ts`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COLORS, glyph, type GlyphName, renderControlKey } from "../src/core/render.ts";

const root = join(import.meta.dirname, "..", "com.alejandrom2.t3deck.sdPlugin", "imgs");

const ACTIONS: Record<string, GlyphName> = {
	slot: "pulse",
	activity: "chat",
	stop: "stop",
	send: "send",
	steer: "steer",
	quick: "spark",
	new: "compose",
	organize: "settle",
	model: "model",
	effort: "effort",
	speed: "speed",
	permissions: "permissions",
	plan: "plan",
	approve: "approve",
	deny: "deny",
	pr: "pullRequest",
	branch: "branch",
	health: "health",
	"dial-threads": "chat",
	"dial-model": "gauge",
	"dial-prompts": "spark",
	"dial-answer": "question",
	"git-commit": "gitCommit",
	"git-push": "gitPush",
	"git-pr": "gitPrCreate",
	"git-pull": "gitPull",
	"pr-fix": "hammer",
	"pr-explain": "book",
	"pr-ask": "question",
	"pr-guide": "spark",
	editor: "editor",
	"dial-pr": "pullRequest",
	limits: "gauge",
	"dial-limits": "gauge",
	usage: "usage",
	"dial-usage": "usage",
};

const svg = (size: number, body: string, background?: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : ""}${body}</svg>`;

const write = (path: string, contents: string) => {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), contents);
};

for (const [name, mark] of Object.entries(ACTIONS)) {
	// Action-list icons follow Elgato's: 72-unit canvas, glyph at ~80%, ~5-unit stroke, plain white.
	write(`actions/${name}/icon.svg`, svg(72, glyph(mark, 3, 3, 66, "#ffffff", 1.9)));
	const key = renderControlKey({ glyph: mark, primary: ["send", "stop", "steer", "quick"].includes(name), tone: name === "deny" ? "deny" : undefined });
	write(`actions/${name}/key.svg`, Buffer.from(key.split(",")[1], "base64").toString());
}

// T3 Code's own mark (MIT, apps/mobile/assets/widget/T3Mark.svg in the T3 Code repo), like Elgato's category uses its partner's.
const T3_MARK =
	"M33.4509 93V47.56H15.5309V37H64.3309V47.56H46.4109V93H33.4509ZM86.7253 93.96C82.832 93.96 78.9653 93.4533 75.1253 92.44C71.2853 91.3733 68.032 89.88 65.3653 87.96L70.4053 78.04C72.5386 79.5867 75.0186 80.8133 77.8453 81.72C80.672 82.6267 83.5253 83.08 86.4053 83.08C89.6586 83.08 92.2186 82.44 94.0853 81.16C95.952 79.88 96.8853 78.12 96.8853 75.88C96.8853 73.7467 96.0586 72.0667 94.4053 70.84C92.752 69.6133 90.0853 69 86.4053 69H80.4853V60.44L96.0853 42.76L97.5253 47.4H68.1653V37H107.365V45.4L91.8453 63.08L85.2853 59.32H89.0453C95.9253 59.32 101.125 60.8667 104.645 63.96C108.165 67.0533 109.925 71.0267 109.925 75.88C109.925 79.0267 109.099 81.9867 107.445 84.76C105.792 87.48 103.259 89.6933 99.8453 91.4C96.432 93.1067 92.0586 93.96 86.7253 93.96Z";
const mark = (size: number, tile: boolean) => {
	const inset = tile ? size * 0.2 : size * 0.06;
	const width = size - inset * 2;
	const scale = width / 95;
	const offsetY = (size - 57 * scale) / 2;
	const body = `<g transform="translate(${inset} ${offsetY}) scale(${scale}) translate(-15 -37)"><path d="${T3_MARK}" fill="#ffffff"/></g>`;
	return svg(size, tile ? `<rect width="${size}" height="${size}" rx="${size * 0.08}" fill="#000000"/>${body}` : body);
};
write("plugin/category-icon.svg", mark(56, false));
write("plugin/marketplace.svg", mark(288, true));
