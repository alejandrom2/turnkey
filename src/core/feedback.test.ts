import { describe, expect, it } from "vitest";

import { failureLabel } from "./feedback.js";
import { RpcError } from "./t3/rpc.js";

describe("failureLabel", () => {
	it("shortens the machine's errors to fit a key", () => {
		expect(failureLabel(new Error("This pairing is read-only."))).toBe("Read only");
		expect(failureLabel(new Error("Not connected to T3 Code."))).toBe("Offline");
		expect(failureLabel(new Error("This T3 Code can't pin threads. Update it."))).toBe("Update T3 Code");
		expect(failureLabel("boom")).toBe("Failed");
	});

	it("shows T3 Code's own reason for refusing", () => {
		const refused = new RpcError("OrchestrationDispatchCommandError", "Failed to dispatch orchestration command thread.model-selection.set (c1).", "The target provider instance is unavailable.");
		expect(failureLabel(refused)).toBe("The target provider instance is unavailable");
		expect(failureLabel(new RpcError("Fail", "Failed to dispatch."))).toBe("Failed");
	});
});
