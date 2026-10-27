import { describe, expect, it } from "vitest";

import { availability } from "./availability.js";

const idle = { deck: "idle", active: false, pinned: false, pendingRequest: undefined } as const;
const running = { ...idle, deck: "running", active: true } as const;
const approval = { ...running, deck: "approval", pendingRequest: { id: "r", kind: "command", createdAt: "", threadId: "t" } } as const;
const question = { ...approval, deck: "question", pendingRequest: { ...approval.pendingRequest, kind: "user_input" } } as const;

const reason = (result: ReturnType<typeof availability>) => (result.available ? "ok" : result.reason);

describe("availability", () => {
	it("needs a running selected thread to stop or steer", () => {
		expect(reason(availability("stop", { thread: running, canOperate: true }))).toBe("ok");
		expect(reason(availability("stop", { thread: idle, canOperate: true }))).toBe("Not running");
		expect(reason(availability("stop", { canOperate: true }))).toBe("No thread");
		expect(reason(availability("steer", { thread: idle, canOperate: true, hasPrompt: true }))).toBe("Not running");
	});

	it("needs a prompt and a thread to send, and a prompt and a machine that may act to start one", () => {
		expect(reason(availability("send", { thread: idle, canOperate: true, hasPrompt: false }))).toBe("No prompt");
		expect(reason(availability("send", { canOperate: true, hasPrompt: true }))).toBe("No thread");
		expect(reason(availability("send", { thread: idle, canOperate: true, hasPrompt: true }))).toBe("ok");
		expect(reason(availability("new", { canOperate: true, hasPrompt: true }))).toBe("ok");
		expect(reason(availability("new", { canOperate: false, hasPrompt: true }))).toBe("Read only");
	});

	it("keeps everything that changes a thread from a read-only pairing, but lets it open threads", () => {
		for (const kind of ["stop", "send", "organize", "model", "answer", "approve", "deny"] as const) {
			expect(reason(availability(kind, { thread: approval, canOperate: false, hasPrompt: true }))).toBe("Read only");
		}
		expect(reason(availability("open", { thread: idle, canOperate: false }))).toBe("ok");
	});

	it("needs a pending request to answer, and an approval to approve or deny", () => {
		expect(reason(availability("answer", { thread: running, canOperate: true }))).toBe("Nothing pending");
		expect(reason(availability("answer", { thread: question, canOperate: true }))).toBe("ok");
		expect(reason(availability("approve", { thread: question, canOperate: true }))).toBe("Nothing pending");
		expect(reason(availability("deny", { thread: approval, canOperate: true }))).toBe("ok");
		expect(reason(availability("approve", { canOperate: true }))).toBe("Nothing pending");
	});

	it("offers pin only on unpinned threads and unpin only on pinned ones", () => {
		expect(reason(availability("pin", { thread: { ...idle, pinned: true }, canOperate: true }))).toBe("Pinned");
		expect(reason(availability("unpin", { thread: idle, canOperate: true }))).toBe("Not pinned");
	});

	it("starts a thread without a prompt, unless its destination is missing", () => {
		expect(reason(availability("launch", { canOperate: true }))).toBe("ok");
		expect(reason(availability("launch", { canOperate: true, missing: "Pick a project" }))).toBe("Pick a project");
		expect(reason(availability("launch", { canOperate: false }))).toBe("Read only");
	});

	it("dims model settings the thread's model can't take, and all of them on a read-only pairing", () => {
		for (const kind of ["model", "effort", "speed", "permissions", "plan"] as const) {
			expect(reason(availability(kind, { thread: idle, canOperate: true }))).toBe("ok");
			expect(reason(availability(kind, { canOperate: true }))).toBe("No thread");
			expect(reason(availability(kind, { thread: idle, canOperate: false }))).toBe("Read only");
		}
		expect(reason(availability("speed", { thread: idle, canOperate: true, missing: "No fast mode" }))).toBe("No fast mode");
		expect(reason(availability("effort", { thread: idle, canOperate: false, missing: "No effort" }))).toBe("No effort");
	});

	it("opens a pull request or branch whenever the thread has one, read-only or not", () => {
		const pr = { url: "https://github.com/o/r/pull/1", number: 1, state: "open" as const };
		expect(reason(availability("pr", { thread: { ...idle, pullRequests: [pr] }, canOperate: false }))).toBe("ok");
		expect(reason(availability("pr", { thread: { ...idle, pullRequests: [] }, canOperate: true }))).toBe("No PR");
		expect(reason(availability("branch", { thread: { ...idle, branch: "fix/x" }, canOperate: false }))).toBe("ok");
		expect(reason(availability("branch", { thread: idle, canOperate: true }))).toBe("No branch");
		expect(reason(availability("pr", { canOperate: true }))).toBe("No thread");
	});

	it("lets Steer act on a queued turn too", () => {
		expect(reason(availability("steer", { thread: { ...idle, deck: "queued", active: true }, canOperate: true, hasPrompt: true }))).toBe("ok");
	});
});
