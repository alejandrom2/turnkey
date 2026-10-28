// Renders Turnkey's logo and app icon: `node scripts/marketplace/logo.ts`.
// Three real keycaps, angled in 3D and rising one above the next: Build (Plan) and Medium (Effort) as the plugin draws
// them, and the mark, a white prompt and T3 Code's blue spark, on the front key. Blender (Cycles, scene.py) renders the
// keys once; Chrome lays them out twice:
// - docs/logo.png, for GitHub and the site: the keys alone on transparency, with a drop shadow.
// - the app icon, for the Marketplace: the keys on a vignetted studio backdrop, rounded. It is the plugin's marketplace.png
//   (256 and 512) and the listing's docs/marketplace/icon.png.
// Needs Google Chrome, Blender and the Stream Deck + model (see capture.ts).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dirname, "..", "..");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BLENDER = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
const MODEL = process.env.STREAMDECK_MODEL ?? join(import.meta.dirname, "model", "streamdeck-plus.glb");
if (!existsSync(MODEL)) throw new Error(`No model at ${MODEL}: convert the STEP file with convert_step.py first.`);
const work = mkdtempSync(join(tmpdir(), "turnkey-logo-"));

/** Screenshots a page Chrome draws from `html`, `size` px square; transparent where the page leaves it. */
function shoot(name: string, html: string, size: number, out: string) {
	writeFileSync(join(work, `${name}.html`), `<html><body style="margin:0;width:${size}px;height:${size}px;overflow:hidden;position:relative;background:transparent">${html}</body></html>`);
	// File access lets the logo's canvas read the render's pixels.
	const args = ["--headless=new", "--hide-scrollbars", "--allow-file-access-from-files", "--virtual-time-budget=5000", "--default-background-color=00000000", `--window-size=${size},${size}`, `--screenshot=${out}`];
	const run = spawnSync(CHROME, [...args, pathToFileURL(join(work, `${name}.html`)).href], { encoding: "utf8" });
	if (run.status !== 0 || !existsSync(out)) throw new Error(`Chrome failed on ${name}:\n${run.stderr}`);
}

// The front key's face: the mark's prompt and spark (scripts/icons.ts), white on the keys' near-black.
const mark = `<svg xmlns="http://www.w3.org/2000/svg" width="576" height="576" viewBox="0 0 144 144"><rect width="144" height="144" fill="#111111"/><g transform="translate(72 72) scale(1.2) translate(-176 -120)"><path d="M142 104 L160 120 L142 136" fill="none" stroke="#ffffff" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"/><path d="M190 100 Q192.5 117.5 210 120 Q192.5 122.5 190 140 Q187.5 122.5 170 120 Q187.5 117.5 190 100Z" fill="#4a68f0"/></g></svg>`;
writeFileSync(join(work, "mark.svg"), mark);
shoot("mark", `<img src="mark.svg" width="576" height="576">`, 576, join(work, "mark.png"));

// Build and Medium as live/deck.ts captured them from the plugin, kept beside this script.
const faces = { build: join(import.meta.dirname, "logo", "build.png"), medium: join(import.meta.dirname, "logo", "medium.png"), mark: join(work, "mark.png") };
const keys = join(work, "keys.png");
// Back to front, in scene.py's stage px on a 1024 frame: a staircase up and to the right, the mark's key turned 14°.
const poses = [
	{ face: "build", x: 252, y: 507, rotate: 0, lift: 0 },
	{ face: "medium", x: 389.5, y: 369.5, rotate: 0, lift: 45 },
	{ face: "mark", x: 527, y: 232, rotate: 14, lift: 90 },
];
const scale = (900 / 288) * (104 / 280) * 0.88;
const job = {
	kind: "floating",
	pieces: poses.map(({ face }) => ({ type: "key", face, x: 0, y: 0 })),
	faces,
	strips: {},
	width: 1024,
	height: 1024,
	samples: 256,
	// Everything sharp: a logo, not a shot.
	fstop: 32,
	model: MODEL,
	frames: [{ pieces: poses.map(({ x, y, rotate, lift }) => ({ x, y, rotate, lift, scale, glow: 1, tiltX: -30, tiltY: 22 })), shimmer: null, out: keys }],
};
writeFileSync(join(work, "job.json"), JSON.stringify(job));
const render = () => spawnSync(BLENDER, ["-b", "--factory-startup", "-P", join(import.meta.dirname, "scene.py"), "--", join(work, "job.json")], { encoding: "utf8", maxBuffer: 1 << 28 });
const failed = (run: ReturnType<typeof render>) => run.status !== 0 || /Traceback|Error:/.test(run.stdout + run.stderr);
let run = render();
// Cycles now and then crashes on Metal; a second run gets through (as in capture.ts).
if (failed(run)) run = render();
if (failed(run)) throw new Error(`Blender failed (status ${run.status}):\n${(run.stdout + run.stderr).slice(-4000)}`);

// The logo: scene.py's floor shadow is translucent black and the keys opaque, so dropping the faint pixels leaves the
// keys alone; a drop shadow, falling down and right as the render's key light does, replaces it.
const logo = join(work, "logo.png");
shoot(
	"logo",
	`<canvas id="c" width="1024" height="1024" style="filter:drop-shadow(24px 48px 40px rgba(30,20,70,.42)) drop-shadow(6px 12px 12px rgba(20,15,40,.28))"></canvas>
<script>
const img = new Image();
img.src = "keys.png";
img.onload = () => {
	const ctx = document.getElementById("c").getContext("2d");
	ctx.drawImage(img, -258, -291, 1485, 1485);
	const pixels = ctx.getImageData(0, 0, 1024, 1024);
	for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = Math.max(0, Math.min(255, ((pixels.data[i] - 170) * 255) / 60));
	ctx.putImageData(pixels, 0, 0);
};
</script>`,
	1024,
	logo,
);

// The app icon: the render with its floor shadow, a deeper drop shadow, and a vignette, on a light studio backdrop.
const tile = join(work, "tile.png");
shoot(
	"tile",
	`<div style="position:absolute;inset:0;background:radial-gradient(120% 90% at 30% 15%,#ffffff 0%,#e9e8ef 40%,#c9c6d6 85%,#b3afc4 100%)"></div>
<img src="keys.png" style="position:absolute;width:1150px;left:-70px;top:-80px;filter:drop-shadow(30px 60px 50px rgba(30,20,70,.45)) drop-shadow(8px 14px 14px rgba(20,15,40,.3))">
<div style="position:absolute;inset:0;background:radial-gradient(90% 80% at 40% 35%,transparent 55%,rgba(40,30,80,.18) 100%)"></div>`,
	1024,
	tile,
);

/** `source` scaled to `size`, its corners rounded by `radius` of its width. */
const scaled = (name: string, source: string, size: number, radius: number, out: string) =>
	shoot(name, `<img src="${pathToFileURL(source).href}" width="${size}" height="${size}" style="display:block;border-radius:${radius * size}px">`, size, out);
const plugin = join(root, "com.alejandrom2.turnkey.sdPlugin", "imgs", "plugin");
scaled("logo-512", logo, 512, 0, join(root, "docs", "logo.png"));
scaled("icon-288", tile, 288, 0.08, join(root, "docs", "marketplace", "icon.png"));
scaled("icon-256", tile, 256, 0.08, join(plugin, "marketplace.png"));
scaled("icon-512", tile, 512, 0.08, join(plugin, "marketplace@2x.png"));
console.log("Wrote docs/logo.png, docs/marketplace/icon.png and the plugin's marketplace.png.");
