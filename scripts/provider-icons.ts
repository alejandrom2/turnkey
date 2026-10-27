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
`;
writeFileSync(new URL("../src/core/providerIcons.ts", import.meta.url), out);
console.log(`wrote ${Object.keys(marks).length} marks: ${Object.keys(marks).join(", ")}`);
if (withoutIcon.length) console.log(`no icon: ${withoutIcon.join(", ")}`);
