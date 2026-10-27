// Writes the manifest's static images from the runtime glyph set: `node scripts/icons.ts`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { COLORS, glyph, type GlyphName, renderControlKey } from "../src/core/render.ts";

const root = join(import.meta.dirname, "..", "com.alejandrom2.turnkey.sdPlugin", "imgs");

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
	"dial-queue": "queued",
	task: "task",
	"dial-tasks": "task",
	skill: "skill",
	"workflow-stop": "workflow",
	fork: "fork",
	merge: "mergeBack",
	"dial-skills": "skill",
	git: "gitCommit",
	"git-commit": "gitCommit",
	"git-push": "gitPush",
	"git-pr": "gitPrCreate",
	"git-pull": "gitPull",
	"pr-fix": "hammer",
	"pr-explain": "book",
	"pr-ask": "question",
	"pr-guide": "spark",
	open: "editor",
	editor: "editor",
	preview: "preview",
	"dial-pr": "pullRequest",
	limits: "gauge",
	"dial-limits": "gauge",
	usage: "usage",
	"dial-usage": "usage",
	"dial-devices": "device",
	update: "update",
	script: "terminal",
	share: "share",
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

/**
 * Turnkey's mark: three keys stacked like a deck of threads, the front one turning, with a prompt on it whose cursor is
 * an agent's spark. On the marketplace tile the spark wears T3 Code's accent blue; the category icon stays plain white,
 * as Elgato's guidelines ask, with the prompt and spark cut through the front key.
 */
const T3_BLUE = "#4a68f0";
const logo = (size: number, tile: boolean) => {
	const ink = tile ? "#000000" : "#ffffff";
	const back = (x: number, y: number, opacity: number) => `<rect x="${x}" y="${y}" width="104" height="104" rx="22" fill="#ffffff" fill-opacity="${opacity}"/>`;
	const prompt = `<path d="M142 104 L160 120 L142 136" fill="none" stroke="${ink}" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/>`;
	const spark = `<path d="M190 100 Q192.5 117.5 210 120 Q192.5 122.5 190 140 Q187.5 122.5 170 120 Q187.5 117.5 190 100Z" fill="${tile ? T3_BLUE : ink}"/>`;
	// Without a tile, the front key's marks are cut out of it rather than drawn on it.
	const front = tile
		? `<rect x="120" y="68" width="104" height="104" rx="22" fill="#ffffff"/>${prompt}${spark}`
		: `<mask id="cut"><rect x="120" y="68" width="104" height="104" rx="22" fill="#ffffff"/><path d="M142 104 L160 120 L142 136" fill="none" stroke="#000000" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/><path d="M190 98 Q192.8 117.2 212 120 Q192.8 122.8 190 142 Q187.2 122.8 168 120 Q187.2 117.2 190 98Z" fill="#000000"/></mask><rect x="120" y="68" width="104" height="104" rx="22" fill="#ffffff" mask="url(#cut)"/>`;
	// The category icon has no room for a margin: the art is scaled up to fill it.
	const art = `${back(64, 116, tile ? 0.22 : 0.4)}${back(92, 92, tile ? 0.45 : 0.65)}<g transform="rotate(14 172 120)">${front}</g>`;
	const fit = tile ? art : `<g transform="translate(-44 -44) scale(1.31)">${art}</g>`;
	return svg(size, `<svg viewBox="0 0 288 288" width="${size}" height="${size}">${tile ? '<rect width="288" height="288" rx="23" fill="#000000"/>' : ""}${fit}</svg>`);
};
write("plugin/category-icon.svg", logo(56, false));
write("plugin/marketplace.svg", logo(288, true));
