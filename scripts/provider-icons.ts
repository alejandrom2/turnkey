// Regenerates src/core/providerIcons.ts from a T3 Code checkout:
// `node scripts/provider-icons.ts <path to t3code repo>`.
// Mirrors apps/web/src/components/chat/ProviderInstanceIcon.tsx: package icons from
// packages/provider-*/src/client.ts (ProviderPackageIcon, dark-theme fill), else the
// built-in React icons in apps/web/src/components/Icons.tsx.
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const repo = process.argv[2];
if (!repo) throw new Error("usage: node scripts/provider-icons.ts <t3code repo>");
const read = (p: string) => readFileSync(join(repo, p), "utf8");

type Mark = { viewBox: string; body: string; color: string; fill: "currentColor" | "native" };
type PkgIcon = {
  viewBox: string;
  fill: { light: string; dark: string };
  paths: Array<{
    d: string;
    fillRule?: string;
    fill?: { light: string; dark: string };
    gradient?: { x1: number; y1: number; x2: number; y2: number; stops: Array<{ offset: number; color: string }> };
  }>;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

// Balanced-brace slice of the object literal following `icon:`.
function objectAfter(src: string, marker: RegExp): string | undefined {
  const m = marker.exec(src);
  if (!m) return undefined;
  let i = src.indexOf("{", m.index + m[0].length - 1);
  const start = i;
  let depth = 0;
  let quote: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i]!;
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === "`") quote = c;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  return undefined;
}

function packageMark(icon: PkgIcon, id: string): Mark {
  const native = icon.paths.some((p) => p.gradient);
  const defs = icon.paths
    .map((p, i) =>
      p.gradient
        ? `<linearGradient id="${id}-${i}" x1="${p.gradient.x1}" y1="${p.gradient.y1}" x2="${p.gradient.x2}" y2="${p.gradient.y2}" gradientUnits="userSpaceOnUse">${p.gradient.stops.map((s) => `<stop offset="${s.offset}" stop-color="${s.color}"/>`).join("")}</linearGradient>`
        : "",
    )
    .join("");
  const paths = icon.paths
    .map((p, i) => {
      const fill = p.gradient ? `url(#${id}-${i})` : p.fill ? p.fill.dark : native ? icon.fill.dark : "currentColor";
      return `<path d="${esc(p.d)}"${p.fillRule ? ` fill-rule="${p.fillRule}"` : ""} fill="${fill}"/>`;
    })
    .join("");
  return {
    viewBox: icon.viewBox,
    body: (defs ? `<defs>${defs}</defs>` : "") + paths,
    color: icon.fill.dark,
    fill: native ? "native" : "currentColor",
  };
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

// Converts one `export const Name: Icon = ... (<svg ...>...</svg>)` from Icons.tsx.
function iconsTsxMark(icons: string, name: string, color: string, fill: Mark["fill"]): Mark {
  const start = icons.indexOf(`export const ${name}: Icon`);
  if (start < 0) throw new Error(`${name} not found in Icons.tsx`);
  const svg = icons.slice(icons.indexOf("<svg", start), icons.indexOf("</svg>", start) + 6);
  const viewBox = /viewBox="([^"]+)"/.exec(svg)![1]!;
  let body = svg.slice(svg.indexOf(">", svg.indexOf("viewBox")) + 1, -6).trim();
  // Resolve `href={CONST}` against a string constant in the same file.
  body = body.replace(/(\w+)=\{([A-Z_]+)\}/g, (_m, attr: string, constName: string) => {
    const value = new RegExp(`const ${constName}\\s*=\\s*\\n?\\s*"([^"]+)"`).exec(icons)?.[1];
    if (!value) throw new Error(`constant ${constName} not found`);
    return `${attr}="${value}"`;
  });
  body = body
    .replace(/\s+className=(\{[^}]*\}|"[^"]*")/g, "")
    .replace(/\s([a-z]+[A-Z][A-Za-z]*)=/g, (_m, attr: string) => ` ${kebab(attr)}=`)
    .replace(/\s*\n\s*/g, " ")
    .replace(/\s*\/>/g, "/>");
  return { viewBox, body, color, fill };
}

const marks: Record<string, Mark> = {};
const icons = read("apps/web/src/components/Icons.tsx");
// PROVIDER_ICON_BY_PROVIDER + PROVIDER_TEXT_COLOR_BY_PROVIDER (dark UI) in ProviderInstanceIcon.tsx.
marks.codex = iconsTsxMark(icons, "OpenAI", "#ffffff", "currentColor");
marks.claudeAgent = iconsTsxMark(icons, "ClaudeAI", "#d97757", "currentColor");
marks.antigravity = iconsTsxMark(icons, "AntigravityIcon", "#5b87bf", "native");

const withoutIcon: string[] = [];
for (const dir of readdirSync(join(repo, "packages")).filter((d) => d.startsWith("provider-")).sort()) {
  const client = join("packages", dir, "src/client.ts");
  if (!existsSync(join(repo, client))) continue;
  const src = read(client);
  const kind = /driverKind:\s*ProviderDriverKind\.make\("([^"]+)"\)/.exec(src)?.[1];
  if (!kind) continue;
  const literal = objectAfter(src, /\bicon:\s*\{/);
  if (!literal) {
    withoutIcon.push(kind);
    continue;
  }
  const icon = new Function(`return (${literal});`)() as PkgIcon;
  marks[kind] = packageMark(icon, `t3-${kind}`);
}

const out = `// Provider marks as T3 Code renders them (apps/web/src/components/chat/ProviderInstanceIcon.tsx). Generated by scripts/provider-icons.ts.
// Brand marks belong to their owners; used only to identify providers, as T3 Code does.
// acpRegistry is T3's generic ACP mark; per-agent registry icons are remote SVGs (see README).
${withoutIcon.length ? `// Driver kinds without a built-in icon: ${withoutIcon.join(", ")}.\n` : ""}
export type ProviderMark = { viewBox: string; body: string; color: string; fill: "currentColor" | "native" };

export const PROVIDER_MARKS: Record<string, ProviderMark> = ${JSON.stringify(marks, null, "\t")};

export function providerMarkSvg(driverKind: string, size: number, opts?: { color?: string }): string | undefined {
	const mark = PROVIDER_MARKS[driverKind];
	if (!mark) return undefined;
	const color = opts?.color ?? mark.color;
	return \`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="\${size}" height="\${size}" viewBox="\${mark.viewBox}" preserveAspectRatio="xMidYMid meet" color="\${color}" fill="\${mark.fill === "currentColor" ? "currentColor" : "none"}">\${mark.body}</svg>\`;
}

// Port of providerInstanceInitials (packages/client-runtime/src/state/providerInstanceDisplay.ts).
export function providerInstanceInitials(label: string): string {
	const words = label
		.replace(/[^\\P{P}'’]+/gu, " ")
		.split(/\\s+/u)
		.map((word) => word.replace(/^['’]+|['’]+$/gu, ""))
		.filter(Boolean);
	if (words.length === 0) return "";
	if (words.length === 1) return Array.from(words[0]!).slice(0, 2).join("").toUpperCase();
	return words
		.slice(0, 2)
		.map((word) => Array.from(word)[0]?.toUpperCase() ?? "")
		.join("");
}

export function normalizeProviderAccentColor(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed : undefined;
}

export function providerAccentForegroundColor(accentColor: string): "#000000" | "#ffffff" {
	const linearChannel = (offset: number) => {
		const value = Number.parseInt(accentColor.slice(offset, offset + 2), 16) / 255;
		return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	const luminance = 0.2126 * linearChannel(1) + 0.7152 * linearChannel(3) + 0.0722 * linearChannel(5);
	const blackContrast = (luminance + 0.05) / 0.05;
	const whiteContrast = 1.05 / (luminance + 0.05);
	return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}

// T3's badge: accent background + contrast foreground, or muted (bg-card/text-muted-foreground) without an accent.
export function initialsBadgeSvg(displayName: string, accentColor: string | undefined, size: number): string {
	const accent = normalizeProviderAccentColor(accentColor);
	const bg = accent ?? "#2a2a2a";
	const fg = accent ? providerAccentForegroundColor(accent) : "#a3a3a3";
	const text = providerInstanceInitials(displayName)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;");
	const r = size / 2;
	return \`<svg xmlns="http://www.w3.org/2000/svg" width="\${size}" height="\${size}" viewBox="0 0 \${size} \${size}"><circle cx="\${r}" cy="\${r}" r="\${r}" fill="\${bg}"/><text x="\${r}" y="\${r}" dy="0.35em" text-anchor="middle" font-family="-apple-system, system-ui, sans-serif" font-weight="600" font-size="\${Math.round(size * 0.42)}" fill="\${fg}">\${text}</text></svg>\`;
}
`;
writeFileSync(new URL("../src/core/providerIcons.ts", import.meta.url), out);
console.log(`wrote ${Object.keys(marks).length} marks: ${Object.keys(marks).join(", ")}`);
if (withoutIcon.length) console.log(`no icon: ${withoutIcon.join(", ")}`);
