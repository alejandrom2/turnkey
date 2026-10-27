import { describe, expect, it } from "vitest";

import { renderCallbackPage } from "./callbackPage.js";
import { approveWithPairingCode, parsePairingLink } from "./oauth.js";

describe("parsePairingLink", () => {
	it("reads the desktop pair link T3 Code creates", () => {
		expect(parsePairingLink("http://192.168.1.20:3773/pair#token=EXAMPLECODE1")).toEqual({
			environmentUrl: "http://192.168.1.20:3773/mcp",
			code: "EXAMPLECODE1",
		});
	});

	it("accepts the older query token and hosted links that name the host", () => {
		expect(parsePairingLink("https://box.ts.net/pair?token=ABC")?.code).toBe("ABC");
		expect(parsePairingLink("https://app.t3.codes/pair?host=https%3A%2F%2Fbox.ts.net#token=ABC")).toEqual({
			environmentUrl: "https://box.ts.net/mcp",
			code: "ABC",
		});
		expect(parsePairingLink("https://app.t3.codes/pair?host=box.ts.net#token=ABC")?.environmentUrl).toBe("https://box.ts.net/mcp");
	});

	it("rejects links without a token or with another scheme", () => {
		expect(parsePairingLink("http://192.168.1.20:3773/pair")).toBeUndefined();
		expect(parsePairingLink("t3code://pair#token=ABC")).toBeUndefined();
		expect(parsePairingLink("not a link")).toBeUndefined();
	});
});

describe("approveWithPairingCode", () => {
	const authorizationUrl = new URL(
		"http://192.168.1.20:3773/oauth/mcp/authorize?response_type=code&client_id=c1&redirect_uri=http%3A%2F%2F127.0.0.1%2Fcb&code_challenge=x&code_challenge_method=S256&state=s1&resource=http%3A%2F%2F192.168.1.20%3A3773%2Fmcp&scope=orchestration%3Aread",
	);

	it("posts the authorization and pairing code to the decision endpoint and returns the code", async () => {
		const requests: { url: string; body: unknown }[] = [];
		const fetchFn = (async (url: URL, init: RequestInit) => {
			requests.push({ url: String(url), body: JSON.parse(String(init.body)) });
			return Response.json({ redirectTo: "http://127.0.0.1/cb?code=AUTH&state=s1&iss=x" });
		}) as typeof fetch;
		await expect(approveWithPairingCode(authorizationUrl, { code: "3NYL", access: "approval-required", state: "s1" }, fetchFn)).resolves.toBe("AUTH");
		expect(requests).toEqual([
			{
				url: "http://192.168.1.20:3773/oauth/mcp/decision",
				body: {
					authorization: {
						response_type: "code",
						client_id: "c1",
						redirect_uri: "http://127.0.0.1/cb",
						code_challenge: "x",
						code_challenge_method: "S256",
						state: "s1",
						resource: "http://192.168.1.20:3773/mcp",
					},
					decision: { _tag: "pairing-code", access: "approval-required", code: "3NYL" },
				},
			},
		]);
	});

	it("surfaces T3 Code's message for a used or unknown code", async () => {
		const fetchFn = (async () => Response.json({ _tag: "AuthMcpApprovalError", message: "That code is unknown or was already used." }, { status: 400 })) as typeof fetch;
		await expect(approveWithPairingCode(authorizationUrl, { code: "OLD", access: "read-only", state: "s1" }, fetchFn)).rejects.toThrow("That code is unknown or was already used.");
	});

	it("refuses a redirect for another request", async () => {
		const fetchFn = (async () => Response.json({ redirectTo: "http://127.0.0.1/cb?code=AUTH&state=other" })) as typeof fetch;
		await expect(approveWithPairingCode(authorizationUrl, { code: "C", access: "read-only", state: "s1" }, fetchFn)).rejects.toThrow("did not match");
	});
});

describe("renderCallbackPage", () => {
	it("escapes the failure message", () => {
		expect(renderCallbackPage({ ok: false, message: "<script>x</script>" })).toContain("&lt;script&gt;x&lt;/script&gt;");
		expect(renderCallbackPage({ ok: true })).toContain("T3 Deck is connected");
	});
});
