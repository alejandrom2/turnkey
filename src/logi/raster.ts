import { Resvg } from "@resvg/resvg-js";

// resvg can't resolve `-apple-system`, the first family render.ts asks for, so text falls back to this.
const FALLBACK_FONT = process.platform === "win32" ? "Segoe UI" : "Helvetica Neue";

/** A face from render.ts (an SVG data URL) as base64 PNG, `size` pixels square. */
export function keyPng(dataUrl: string, size: number): string {
	const svg = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64").toString();
	const resvg = new Resvg(svg, { fitTo: { mode: "width", value: size }, font: { loadSystemFonts: true, defaultFontFamily: FALLBACK_FONT } });
	return resvg.render().asPng().toString("base64");
}
