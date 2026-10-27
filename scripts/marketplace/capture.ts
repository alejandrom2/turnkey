// Writes the marketplace icon, thumbnail, gallery and video to docs/marketplace:
// `node --import ./scripts/resolve-ts.mjs scripts/marketplace/capture.ts [--no-video]`. Needs Google Chrome and ffmpeg.
import { spawn } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import WebSocket from "ws";

import { faces } from "./faces.ts";

const root = join(import.meta.dirname, "..", "..");
const out = join(root, "docs", "marketplace");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const GALLERY = ["threads", "answer", "model", "prompts", "git", "usage"];
const FPS = 30;

// The page, its faces and the plugin icon side by side in a scratch folder.
const work = mkdtempSync(join(tmpdir(), "turnkey-marketplace-"));
copyFileSync(join(import.meta.dirname, "page.html"), join(work, "page.html"));
writeFileSync(join(work, "faces.js"), `window.FACES = ${JSON.stringify(faces())};`);
const icon = readFileSync(join(root, "com.alejandrom2.turnkey.sdPlugin", "imgs", "plugin", "marketplace.svg"), "utf8");
writeFileSync(join(work, "icon.svg"), icon);
// The store rounds the icon itself, so the listing's copy is full-bleed.
writeFileSync(join(work, "icon-square.svg"), icon.replace(/ rx="23"/, ""));
mkdirSync(out, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", "--remote-debugging-port=0", "--hide-scrollbars", "--force-device-scale-factor=1", `--user-data-dir=${join(work, "profile")}`, "about:blank"], {
	stdio: ["ignore", "ignore", "pipe"],
});
const endpoint = await new Promise<string>((resolve, reject) => {
	let log = "";
	chrome.stderr.on("data", (chunk) => {
		log += chunk;
		const found = /DevTools listening on (ws:\/\/\S+)/.exec(log);
		if (found) resolve(found[1]!);
	});
	chrome.on("exit", () => reject(new Error(`Chrome exited:\n${log}`)));
});

const port = new URL(endpoint).port;
const target = (await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json()) as { webSocketDebuggerUrl: string };
const socket = new WebSocket(target.webSocketDebuggerUrl, { perMessageDeflate: false });
await new Promise((resolve) => socket.once("open", resolve));

let nextId = 0;
const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
const waiters = new Map<string, () => void>();
socket.on("message", (data) => {
	const message = JSON.parse(String(data));
	if (message.id !== undefined) {
		const call = pending.get(message.id)!;
		pending.delete(message.id);
		if (message.error) call.reject(new Error(message.error.message));
		else call.resolve(message.result);
	} else waiters.get(message.method)?.();
});
const send = (method: string, params: object = {}): Promise<any> =>
	new Promise((resolve, reject) => {
		const id = ++nextId;
		pending.set(id, { resolve, reject });
		socket.send(JSON.stringify({ id, method, params }));
	});
const evaluate = async (expression: string) => {
	const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
	if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
	return result.value;
};

await send("Page.enable");
async function open(file: string, query: string, width: number, height: number) {
	await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
	const loaded = new Promise<void>((resolve) => waiters.set("Page.loadEventFired", resolve));
	await send("Page.navigate", { url: `${pathToFileURL(join(work, file)).href}${query}` });
	await loaded;
	if (file === "page.html") await evaluate("window.ready()");
}
async function shot(format: "png" | "jpeg" = "png"): Promise<Buffer> {
	const { data } = await send("Page.captureScreenshot", { format, quality: format === "jpeg" ? 95 : undefined, captureBeyondViewport: false });
	return Buffer.from(data, "base64");
}
async function still(name: string, query: string, width: number, height: number, file = "page.html") {
	await open(file, query, width, height);
	writeFileSync(join(out, name), await shot());
	console.log(`docs/marketplace/${name}`);
}

try {
	await still("icon.png", "", 288, 288, "icon-square.svg");
	await still("thumbnail.png", "?scene=thumbnail", 1920, 960);
	for (const [index, scene] of GALLERY.entries()) await still(`gallery-${index + 1}-${scene}.png`, `?scene=${scene}`, 1920, 960);

	if (!process.argv.includes("--no-video")) {
		await open("page.html", "?video=1", 1920, 1080);
		const length: number = await evaluate("window.VIDEO_LENGTH");
		const ffmpeg = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", join(out, "video.mp4")], {
			stdio: ["pipe", "inherit", "inherit"],
		});
		const frames = Math.round(length * FPS);
		for (let frame = 0; frame < frames; frame++) {
			await evaluate(`render(${frame / FPS}); window.ready()`);
			if (!ffmpeg.stdin.write(await shot("jpeg"))) await new Promise((resolve) => ffmpeg.stdin.once("drain", resolve));
		}
		ffmpeg.stdin.end();
		await new Promise((resolve, reject) => ffmpeg.on("exit", (code) => (code === 0 ? resolve(code) : reject(new Error(`ffmpeg exited ${code}`)))));
		console.log(`docs/marketplace/video.mp4 (${length}s, ${frames} frames)`);
	}
} finally {
	socket.close();
	chrome.kill();
}
