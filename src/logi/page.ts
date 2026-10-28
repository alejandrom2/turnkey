import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { t } from "../core/i18n.js";
import { escapeXml } from "../core/render.js";

export type PairingPage = { url: string; close(): void };

/** A pair link is a URL; anything much longer isn't one. */
const MAX_BODY = 8_192;

const HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"cache-control": "no-store",
	"x-frame-options": "DENY",
	"content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
};

function html(body: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(t("notice.pairDeck"))}</title><style>
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--text:#16181d;--muted:#5b6170;--line:#d9dce3;--accent:#5b8cff;--ok:#1f9d55;--bad:#d64545}
@media (prefers-color-scheme:dark){:root{--bg:#111;--card:#1b1d22;--text:#f5f7fb;--muted:#9aa0ab;--line:#2c2f36;--ok:#40c977;--bad:#ff6764}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{width:min(440px,calc(100vw - 32px));background:var(--card);border:1px solid var(--line);border-radius:14px;padding:28px}
h1{margin:0 0 6px;font-size:22px}p{margin:0 0 18px;color:var(--muted)}
input{box-sizing:border-box;width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:9px;background:transparent;color:inherit;font:inherit}
button{margin-top:12px;width:100%;padding:11px;border:0;border-radius:9px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}
.ok{color:var(--ok)}.bad{color:var(--bad)}
</style></head><body><main>${body}</main></body></html>`;
}

function form(problem?: string): string {
	return html(
		`<h1>${escapeXml(t("notice.pairDeck"))}</h1><p>${escapeXml(t("needs.fix.newPairLink"))}</p>` +
			(problem ? `<p class="bad">${escapeXml(problem)}</p>` : "") +
			`<form method="post"><input name="link" type="url" required autofocus autocomplete="off" placeholder="${escapeXml(t("inspector.card.linkPlaceholder"))}"><button>${escapeXml(t("inspector.card.connect"))}</button></form>`,
	);
}

function readBody(request: IncomingMessage): Promise<string | undefined> {
	return new Promise((resolve, reject) => {
		let body = "";
		let tooBig = false;
		request.setEncoding("utf8");
		request.on("data", (chunk: string) => {
			if (tooBig) return;
			body += chunk;
			if (body.length > MAX_BODY) tooBig = true;
		});
		request.on("end", () => resolve(tooBig ? undefined : body));
		request.on("error", reject);
	});
}

/**
 * Serves the form for a T3 Code pair link on this computer only, at a random address the plugin's banner opens.
 * The Host and Origin checks keep other sites, and DNS rebinding, from reaching it.
 */
export async function startPairingPage(pair: (link: string) => Promise<string>): Promise<PairingPage> {
	const path = `/pair/${randomBytes(16).toString("hex")}`;
	let origin = "";

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const reply = (status: number, body: string): void => {
			response.writeHead(status, HEADERS).end(body);
		};
		if (request.url !== path) return void response.writeHead(404).end();
		if (`http://${request.headers.host}` !== origin) return void response.writeHead(403).end();
		if (request.method === "GET") return reply(200, form());
		if (request.method !== "POST") return void response.writeHead(405).end();
		if (request.headers.origin !== undefined && request.headers.origin !== origin) return void response.writeHead(403).end();
		const body = await readBody(request);
		if (body === undefined) return void response.writeHead(413).end();
		const link = new URLSearchParams(body).get("link")?.trim() ?? "";
		try {
			const name = await pair(link);
			reply(200, html(`<h1>${escapeXml(t("needs.paired"))}</h1><p class="ok">${escapeXml(t("logi.page.paired", { name }))}</p>`));
		} catch (error) {
			reply(400, form(error instanceof Error ? error.message : String(error)));
		}
	}

	const server = createServer((request, response) => void handle(request, response).catch(() => response.writeHead(500).end()));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { url: `${origin}${path}`, close: () => server.close() };
}
