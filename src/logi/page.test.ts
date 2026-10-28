import { afterEach, describe, expect, it } from "vitest";

import { t } from "../core/i18n.js";
import { type PairingPage, startPairingPage } from "./page.js";

let page: PairingPage | undefined;
afterEach(() => page?.close());

const post = (url: string, body: string, headers: Record<string, string> = {}) =>
	fetch(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });

describe("the pairing page", () => {
	it("serves a form only at its own one-time address on this computer", async () => {
		page = await startPairingPage(async () => "Studio");
		expect(new URL(page.url).hostname).toBe("127.0.0.1");
		const form = await fetch(page.url);
		expect(form.status).toBe(200);
		expect(await form.text()).toContain(t("inspector.card.connect"));
		expect((await fetch(new URL("/pair/guess", page.url))).status).toBe(404);
		expect((await fetch(new URL("/", page.url))).status).toBe(404);
	});

	it("pairs with the pasted link and says with what", async () => {
		const links: string[] = [];
		page = await startPairingPage(async (link) => {
			links.push(link);
			return "Studio";
		});
		const done = await post(page.url, `link=${encodeURIComponent("http://studio:3773/pair#token=ABC")}`);
		expect(links).toEqual(["http://studio:3773/pair#token=ABC"]);
		expect(await done.text()).toContain(t("logi.page.paired", { name: "Studio" }));
	});

	it("shows why pairing failed, escaped", async () => {
		page = await startPairingPage(async () => {
			throw new Error("<b>nope</b>");
		});
		const failed = await post(page.url, "link=x");
		expect(failed.status).toBe(400);
		const html = await failed.text();
		expect(html).toContain("&lt;b&gt;nope&lt;/b&gt;");
		expect(html).not.toContain("<b>nope</b>");
	});

	it("refuses another site's page posting to it", async () => {
		const links: string[] = [];
		page = await startPairingPage(async (link) => {
			links.push(link);
			return "Studio";
		});
		expect((await post(page.url, "link=x", { origin: "https://evil.example" })).status).toBe(403);
		expect(links).toEqual([]);
	});

	it("refuses an oversized post", async () => {
		page = await startPairingPage(async () => "Studio");
		expect((await post(page.url, `link=${"a".repeat(20_000)}`)).status).toBe(413);
	});
});
