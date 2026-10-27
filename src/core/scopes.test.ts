import { describe, expect, it } from "vitest";

import { failureLabel } from "./feedback.js";
import { readScopeRequests, requestScope, settleScopeRequests } from "./scopes.js";
import { RpcError } from "./t3/rpc.js";

const URL_ = "http://studio:3773";

describe("scope requests", () => {
	it("flags an opt-in scope once per machine and keeps only scopes the deck asks for", () => {
		const flagged = requestScope({}, URL_, "providers:manage");
		expect(flagged).toEqual({ [URL_]: ["providers:manage"] });
		expect(requestScope(flagged, URL_, "providers:manage")).toBe(flagged);
		expect(readScopeRequests({ [URL_]: ["providers:manage", "orchestration:operate", 3], other: "x", empty: [] })).toEqual({ [URL_]: ["providers:manage"] });
		expect(readScopeRequests(null)).toEqual({});
	});

	it("clears what a pairing granted and keeps the rest for the next one", () => {
		const flagged = requestScope(requestScope({}, URL_, "providers:manage"), URL_, "terminal:operate");
		expect(settleScopeRequests(flagged, URL_, ["orchestration:read", "providers:manage"])).toEqual({ [URL_]: ["terminal:operate"] });
		expect(settleScopeRequests(flagged, URL_, ["providers:manage", "terminal:operate"])).toEqual({});
	});
});

describe("denials", () => {
	it("say which access is missing from requiredPermission", () => {
		const denial = (permission: string) => new RpcError("EnvironmentAuthorizationError", "missing", undefined, permission);
		expect(failureLabel(denial("source-control:write"))).toBe("Needs source control access — re-pair");
		expect(failureLabel(denial("diagnostics:read"))).toBe("Needs usage access — re-pair");
		expect(failureLabel(denial("providers:manage"))).toBe("Needs provider access — re-pair to enable");
		expect(failureLabel(denial("orchestration:operate"))).toBe("Read only");
		expect(failureLabel(denial("terminal:operate"))).toBe("Needs more access — re-pair");
	});
});
