import { afterEach, describe, expect, it } from "vitest";

import { t } from "../core/i18n.js";
import { type MachineRow, type PairingPage, type PageActions, startPairingPage } from "./page.js";

let page: PairingPage | undefined;
afterEach(() => page?.close());

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
	fetch(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });

const STUDIO: MachineRow = { url: "http://studio:3773", label: "Studio", state: "connected" };

function actions(overrides: Partial<PageActions> = {}): PageActions & { removed: string[] } {
	const removed: string[] = [];
	return { pair: async () => "Studio", machines: () => [STUDIO], remove: async (url) => void removed.push(url), removed, ...overrides };
}

describe("the machines page", () => {
	it("serves only at its own one-time address on this computer", async () => {
		page = await startPairingPage(actions());
		expect(new URL(page.url).hostname).toBe("127.0.0.1");
		const form = await fetch(page.url);
		expect(form.status).toBe(200);
		expect(await form.text()).toContain(t("inspector.card.connect"));
		expect((await fetch(new URL("/pair/guess", page.url))).status).toBe(404);
		expect((await fetch(new URL("/", page.url))).status).toBe(404);
	});

	it("lists each machine with its state and a way to remove it", async () => {
		const machines: MachineRow[] = [STUDIO, { url: "http://laptop:3773", label: "Laptop", state: "problem", detail: t("machine.pairingExpired") }];
		page = await startPairingPage(actions({ machines: () => machines }));
		const html = await (await fetch(page.url)).text();
		for (const text of ["Studio", t("inspector.card.connected"), "Laptop", t("machine.pairingExpired"), t("inspector.card.remove"), t("inspector.card.addMachine")]) expect(html).toContain(text);
	});

	it("says when there are no machines yet", async () => {
		page = await startPairingPage(actions({ machines: () => [] }));
		expect(await (await fetch(page.url)).text()).toContain(t("inspector.card.noMachines"));
	});

	it("pairs with the pasted link, adding a machine or re-pairing one, and says with what", async () => {
		const links: string[] = [];
		page = await startPairingPage(
			actions({
				pair: async (link) => {
					links.push(link);
					return "Studio";
				},
			}),
		);
		const done = await post(page.url, `link=${encodeURIComponent("http://studio:3773/pair#token=ABC")}`);
		expect(links).toEqual(["http://studio:3773/pair#token=ABC"]);
		expect(await done.text()).toContain(t("logi.page.paired", { name: "Studio" }));
	});

	it("removes a listed machine, and only a listed one", async () => {
		const subject = actions();
		page = await startPairingPage(subject);
		expect((await post(page.url, `remove=${encodeURIComponent(STUDIO.url)}`)).status).toBe(200);
		expect((await post(page.url, `remove=${encodeURIComponent("http://elsewhere:3773")}`)).status).toBe(400);
		expect(subject.removed).toEqual([STUDIO.url]);
	});

	it("shows why pairing failed, escaped", async () => {
		page = await startPairingPage(
			actions({
				pair: async () => {
					throw new Error("<b>nope</b>");
				},
			}),
		);
		const failed = await post(page.url, "link=x");
		expect(failed.status).toBe(400);
		const html = await failed.text();
		expect(html).toContain("&lt;b&gt;nope&lt;/b&gt;");
		expect(html).not.toContain("<b>nope</b>");
	});

	it("refuses another site's page posting to it", async () => {
		const subject = actions();
		page = await startPairingPage(subject);
		expect((await post(page.url, `remove=${encodeURIComponent(STUDIO.url)}`, { origin: "https://evil.example" })).status).toBe(403);
		expect(subject.removed).toEqual([]);
	});

	it("refuses an oversized post", async () => {
		page = await startPairingPage(actions());
		expect((await post(page.url, `link=${"a".repeat(20_000)}`)).status).toBe(413);
	});
});
