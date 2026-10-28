import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { t } from "../core/i18n.js";
import { escapeXml } from "../core/render.js";

export type PairingPage = { url: string; close(): void };

/** A machine as the page lists it; `detail` says what's wrong when it has a problem. */
export type MachineRow = { url: string; label: string; state: "connected" | "connecting" | "needsPairing" | "problem"; detail?: string };

/** What the page does: spend a pair link (adding a machine or re-pairing one), list the machines, forget one, switch haptics. */
export type PageActions = {
	pair(link: string): Promise<string>;
	machines(): readonly MachineRow[];
	remove(url: string): Promise<void>;
	haptics(): boolean;
	setHaptics(on: boolean): Promise<void>;
};

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
h2{margin:22px 0 8px;font-size:15px}ul{list-style:none;margin:0 0 6px;padding:0}
li{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--line)}li:first-child{border-top:0}
li div{flex:1;min-width:0}li strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}li span{font-size:14px;color:var(--muted)}
li form button{margin:0;width:auto;padding:6px 12px;background:transparent;color:var(--bad);border:1px solid var(--line)}
.switch{display:flex;gap:0;border:1px solid var(--line);border-radius:9px;overflow:hidden;width:max-content}
.switch button{margin:0;width:auto;padding:8px 18px;border-radius:0;background:transparent;color:inherit}
.switch button[aria-pressed="true"]{background:var(--accent);color:#fff}
</style></head><body><main>${body}</main></body></html>`;
}

const STATE_TEXT = { connected: "inspector.card.connected", connecting: "health.connecting", needsPairing: "inspector.card.needsPairing", problem: "health.offline" } as const;

function list(machines: readonly MachineRow[]): string {
	if (machines.length === 0) return `<p>${escapeXml(t("inspector.card.noMachines"))}</p>`;
	const row = (machine: MachineRow) => {
		const state = machine.detail ?? t(STATE_TEXT[machine.state]);
		const tone = machine.state === "connected" ? "ok" : machine.state === "problem" ? "bad" : "";
		return `<li><div><strong>${escapeXml(machine.label)}</strong><span class="${tone}">${escapeXml(state)}</span></div><form method="post"><input type="hidden" name="remove" value="${escapeXml(machine.url)}"><button>${escapeXml(t("inspector.card.remove"))}</button></form></li>`;
	};
	return `<ul>${machines.map(row).join("")}</ul>`;
}

function haptics(on: boolean): string {
	const choice = (value: "on" | "off", label: string) => `<button name="haptics" value="${value}" aria-pressed="${on === (value === "on")}">${escapeXml(label)}</button>`;
	return `<h2>${escapeXml(t("logi.page.haptics"))}</h2><p>${escapeXml(t("logi.page.hapticsHint"))}</p><form method="post" class="switch">${choice("on", t("option.on"))}${choice("off", t("option.off"))}</form>`;
}

function page(actions: PageActions, notice?: { ok: boolean; text: string }): string {
	return html(
		`<h1>${escapeXml(t("inspector.settings.title"))}</h1><h2>${escapeXml(t("inspector.card.machines"))}</h2>${list(actions.machines())}` +
			`<h2>${escapeXml(t("inspector.card.addMachine"))}</h2><p>${escapeXml(t("needs.fix.newPairLink"))}</p>` +
			(notice ? `<p class="${notice.ok ? "ok" : "bad"}">${escapeXml(notice.text)}</p>` : "") +
			`<form method="post"><input name="link" type="url" required autocomplete="off" placeholder="${escapeXml(t("inspector.card.linkPlaceholder"))}"><button>${escapeXml(t("inspector.card.connect"))}</button></form>` +
			haptics(actions.haptics()),
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
 * Serves Turnkey Settings on this computer only, at a random address the banner and the settings action open: machines
 * (list, Remove, and a pair link field that adds one or re-pairs it) and haptics. The Host and Origin checks keep other
 * sites, and DNS rebinding, out.
 */
export async function startPairingPage(actions: PageActions): Promise<PairingPage> {
	const path = `/pair/${randomBytes(16).toString("hex")}`;
	let origin = "";

	async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
		const reply = (status: number, body: string): void => {
			response.writeHead(status, HEADERS).end(body);
		};
		if (request.url !== path) return void response.writeHead(404).end();
		if (`http://${request.headers.host}` !== origin) return void response.writeHead(403).end();
		if (request.method === "GET") return reply(200, page(actions));
		if (request.method !== "POST") return void response.writeHead(405).end();
		if (request.headers.origin !== undefined && request.headers.origin !== origin) return void response.writeHead(403).end();
		const body = await readBody(request);
		if (body === undefined) return void response.writeHead(413).end();
		const fields = new URLSearchParams(body);
		const removing = fields.get("remove");
		const buzz = fields.get("haptics");
		try {
			if (buzz === "on" || buzz === "off") {
				await actions.setHaptics(buzz === "on");
				return reply(200, page(actions));
			}
			if (removing !== null) {
				// Only a machine the page lists can be removed, whatever the form says.
				if (!actions.machines().some((machine) => machine.url === removing)) return void response.writeHead(400).end();
				await actions.remove(removing);
				return reply(200, page(actions));
			}
			const name = await actions.pair(fields.get("link")?.trim() ?? "");
			reply(200, page(actions, { ok: true, text: t("logi.page.paired", { name }) }));
		} catch (error) {
			reply(400, page(actions, { ok: false, text: error instanceof Error ? error.message : String(error) }));
		}
	}

	const server = createServer((request, response) => void handle(request, response).catch(() => response.writeHead(500).end()));
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { url: `${origin}${path}`, close: () => server.close() };
}
