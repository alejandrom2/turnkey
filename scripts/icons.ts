// Writes the manifest's static images from the runtime glyph set: `node scripts/icons.ts`.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { glyph, type GlyphName, renderControlKey, svgMarkup } from "../src/core/render.ts";

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

const svg = (size: number, body: string) => svgMarkup(size, size, body);

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
 * an agent's spark. On the marketplace tile the spark wears T3 Code's accent blue; the category icon keeps to white and gray,
 * close to Elgato's white category icons, with the prompt and spark drawn dark on the front key.
 */
const T3_BLUE = "#4a68f0";
// Flat SVG only: Stream Deck's renderer draws a nested <svg> or a mask as nothing.
const logo = (size: number, tile: boolean) => {
	const back = (x: number, y: number, opacity: number) => `<rect x="${x}" y="${y}" width="104" height="104" rx="22" fill="#ffffff" fill-opacity="${opacity}"/>`;
	const spark = "M190 100 Q192.5 117.5 210 120 Q192.5 122.5 190 140 Q187.5 122.5 170 120 Q187.5 117.5 190 100Z";
	// On the category icon the marks are drawn in Stream Deck's sidebar gray: as holes they showed the keys behind them.
	const ink = tile ? "#000000" : "#262626";
	const front = `<rect x="120" y="68" width="104" height="104" rx="22" fill="#ffffff"/><path d="M142 104 L160 120 L142 136" fill="none" stroke="${ink}" stroke-width="${tile ? 12 : 16}" stroke-linecap="round" stroke-linejoin="round"/><path d="${spark}" fill="${tile ? T3_BLUE : ink}"/>`;
	const art = `${back(64, 116, tile ? 0.22 : 0.4)}${back(92, 92, tile ? 0.45 : 0.65)}<g transform="rotate(14 172 120)">${front}</g>`;
	// Scaled into `size` with one transform; the category icon drops the tile and fills its box.
	const scale = size / 288;
	const body = tile ? `<rect width="288" height="288" rx="23" fill="#000000"/>${art}` : `<g transform="translate(-44 -44) scale(1.31)">${art}</g>`;
	return svg(size, `<g transform="scale(${+scale.toFixed(5)})">${body}</g>`);
};
write("plugin/category-icon.svg", logo(56, false));
write("plugin/marketplace.svg", logo(288, true));
