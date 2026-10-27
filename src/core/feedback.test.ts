import { describe, expect, it } from "vitest";

import { failureLabel } from "./feedback.js";

describe("failureLabel", () => {
	it("shortens the machine's errors to fit a key", () => {
		expect(failureLabel(new Error("This pairing is read-only."))).toBe("Read only");
		expect(failureLabel(new Error("Not connected to T3 Code."))).toBe("Offline");
		expect(failureLabel(new Error("This T3 Code can't pin threads. Update it."))).toBe("Update T3 Code");
		expect(failureLabel("boom")).toBe("Failed");
	});
});
