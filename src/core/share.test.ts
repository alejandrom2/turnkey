import { describe, expect, it, vi } from "vitest";

import { readGuestShare, shareFailure, ShareStore, shareView } from "./share.js";

const NOW = Date.parse("2026-10-27T12:00:00Z");
const share = (patch: Record<string, unknown> = {}) => ({ id: "s1", host: "box.t3.codes", expiresAt: "2026-10-28T10:00:00Z", guestName: null, messages: [], ...patch });

describe("guest share", () => {
	it("reads the share off a thread snapshot", () => {
		expect(readGuestShare({ thread: { guestShare: share() } })).toEqual({ id: "s1", expiresAt: "2026-10-28T10:00:00Z", guestName: null, messages: [] });
		expect(readGuestShare({ thread: { guestShare: null } })).toBeNull();
		expect(readGuestShare({ thread: {} })).toBeNull();
		expect(readGuestShare(undefined)).toBeNull();
	});

	it("shows a live link with its guest and waiting messages, and one past its day as expired", () => {
		expect(shareView(null, NOW)).toEqual({ kind: "none" });
		expect(shareView(readGuestShare({ thread: { guestShare: share() } }), NOW)).toEqual({ kind: "active", guest: null, pending: 0 });
		const joined = share({ guestName: "Sam", messages: [{ status: "pending" }, { status: "sent" }, { status: "pending" }] });
		expect(shareView(readGuestShare({ thread: { guestShare: joined } }), NOW)).toEqual({ kind: "active", guest: "Sam", pending: 2 });
		expect(shareView(readGuestShare({ thread: { guestShare: share({ expiresAt: "2026-10-27T11:59:00Z" }) } }), NOW)).toEqual({ kind: "expired" });
	});

	it("words T3 Code's refusals", () => {
		expect(shareFailure("disabled")).toBe("Turn on guest links");
		expect(shareFailure("connect_unavailable")).toBe("Needs T3 Connect");
		expect(shareFailure("read_failed")).toBeUndefined();
		expect(shareFailure(undefined)).toBeUndefined();
	});
});

describe("share store", () => {
	it("reads a thread's share once per change of its row", async () => {
		const onChange = vi.fn();
		const store = new ShareStore(onChange);
		const read = vi.fn(async () => readGuestShare({ thread: { guestShare: share() } }));
		expect(store.of({ key: "e/t", stamp: "1" }, read)).toBeUndefined();
		await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
		expect(store.of({ key: "e/t", stamp: "1" }, read)?.id).toBe("s1");
		expect(read).toHaveBeenCalledTimes(1);
		store.of({ key: "e/t", stamp: "2" }, read);
		await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
	});

	it("takes what the deck just did without waiting for a read", async () => {
		const onChange = vi.fn();
		const store = new ShareStore(onChange);
		const read = vi.fn(async () => null);
		store.of({ key: "e/t", stamp: "1" }, read);
		await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
		store.set("e/t", readGuestShare({ thread: { guestShare: share() } }));
		expect(store.of({ key: "e/t", stamp: "1" }, read)?.id).toBe("s1");
	});
});
