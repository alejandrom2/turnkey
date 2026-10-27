// Cases ported from T3 Code's packages/shared/src/usageLimits.test.ts (pace, pools and pooled columns).
import { describe, expect, it } from "vitest";

import { collectLimitAccounts, collectLimitPools, elapsedShare, type LimitAccount, limitsExpireAt, limitsStale, paceRemainingPercent } from "./limits.js";
import type { LimitProvider } from "./types.js";

const now = Date.parse("2026-09-03T12:00:00.000Z");

const window = {
	id: "five_hour",
	kind: "session",
	label: "Session",
	usedPercent: 40,
	windowDurationMins: 300,
	resetsAt: "2026-09-03T14:00:00.000Z",
} as const;

function provider(overrides: Partial<LimitProvider>): LimitProvider {
	return {
		instanceId: "codex",
		driver: "codex",
		enabled: true,
		installed: true,
		auth: { status: "authenticated" },
		...overrides,
	};
}

describe("pace", () => {
	it("places the clock three fifths through a five-hour window with two hours left", () => {
		expect(elapsedShare(window, now)).toBeCloseTo(0.6);
		expect(paceRemainingPercent(window, now)).toBe(40);
	});
});

describe("pools", () => {
	const checkedAt = "2026-09-03T11:00:00.000Z";
	const weekly = {
		id: "seven_day",
		kind: "weekly",
		label: "Weekly",
		windowDurationMins: 7 * 24 * 60,
		resetsAt: "2026-09-06T12:00:00.000Z",
	} as const;
	const claude = "claudeAgent";
	const source = {
		id: "hub",
		kind: "cliproxy" as const,
		label: "hub",
		checkedAt,
	};
	const laptop = { entry: { target: { label: "Laptop" } } };

	it("merges one account reported natively on two environments and by a hub into one entry", () => {
		const native = provider({
			driver: claude,
			instanceId: "claude",
			auth: { status: "authenticated", email: "Same@example.com" },
			usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 40 }] },
		});
		const input = new Map([
			["env-a", { ...laptop, serverConfig: { providers: [native] } }],
			[
				"env-b",
				{
					entry: { target: { label: "Desktop" } },
					serverConfig: {
						providers: [
							{
								...native,
								usageLimits: {
									checkedAt: "2026-09-03T11:30:00.000Z",
									windows: [{ ...window, usedPercent: 55 }],
								},
							},
						],
						usageLimitSources: [
							{
								...source,
								accounts: [
									{
										id: "claude-same@example.com.json",
										driver: claude,
										email: "same@example.com",
										plan: "Claude Subscription",
										usageLimits: { checkedAt, windows: [{ ...window, usedPercent: 10 }] },
									},
								],
							},
						],
					},
				},
			],
		]);
		const accounts = collectLimitAccounts(input);
		expect(accounts).toHaveLength(1);
		expect(accounts[0]).toMatchObject({
			key: "env-a:claude",
			sourceLabel: null,
			redeem: { environmentId: "env-b", input: { instanceId: "claude" } },
			environments: [
				{ environmentId: "env-a", label: "Laptop" },
				{ environmentId: "env-b", label: "Desktop" },
			],
		});
		expect(accounts[0]?.limits.windows[0]?.usedPercent).toBe(55);
	});

	it("merges OpenCode Go limits from machines with the same API key", () => {
		const go = provider({
			driver: "opencode",
			instanceId: "opencode",
			auth: { status: "authenticated" },
			usageLimits: {
				checkedAt,
				credentialFingerprint: "shared-go-key",
				windows: [{ ...window, id: "go_rolling", usedPercent: 3 }],
			},
		});
		const input = new Map([
			["env-a", { ...laptop, serverConfig: { providers: [go] } }],
			[
				"env-b",
				{
					entry: { target: { label: "Desktop" } },
					serverConfig: {
						providers: [
							{
								...go,
								usageLimits: {
									...go.usageLimits!,
									checkedAt: "2026-09-03T11:30:00.000Z",
									windows: [{ ...window, id: "go_rolling", usedPercent: 4 }],
								},
							},
						],
					},
				},
			],
		]);
		const accounts = collectLimitAccounts(input);
		expect(accounts).toHaveLength(1);
		expect(accounts[0]?.environments).toEqual([
			{ environmentId: "env-a", label: "Laptop" },
			{ environmentId: "env-b", label: "Desktop" },
		]);
		expect(collectLimitPools(accounts, now)[0]?.windows[0]?.members).toHaveLength(1);
		expect(accounts[0]?.limits.windows[0]?.usedPercent).toBe(4);

		const differentKey = {
			...go,
			usageLimits: { ...go.usageLimits!, credentialFingerprint: "other-go-key" },
		};
		input.set("env-b", {
			entry: { target: { label: "Desktop" } },
			serverConfig: { providers: [differentKey] },
		});
		expect(collectLimitAccounts(input)).toHaveLength(2);

		input.set("env-a", {
			...laptop,
			serverConfig: {
				providers: [{ ...go, auth: { status: "authenticated", email: "same@example.com" } }],
			},
		});
		input.set("env-b", {
			entry: { target: { label: "Desktop" } },
			serverConfig: {
				providers: [
					{ ...differentKey, auth: { status: "authenticated", email: "SAME@example.com" } },
				],
			},
		});
		expect(collectLimitAccounts(input)).toHaveLength(1);
	});

	it("takes windows from a fresher hub read but credits and redeem from the native instance", () => {
		const native = provider({
			driver: claude,
			instanceId: "claude",
			auth: { status: "authenticated", email: "same@example.com" },
			usageLimits: {
				checkedAt,
				windows: [{ ...window, usedPercent: 40 }],
				resetCredits: { availableCount: 2 },
			},
		});
		const input = new Map([
			[
				"env-a",
				{
					...laptop,
					serverConfig: {
						providers: [native],
						usageLimitSources: [
							{
								...source,
								accounts: [
									{
										id: "claude-same@example.com.json",
										driver: claude,
										email: "same@example.com",
										usageLimits: {
											checkedAt: "2026-09-03T11:30:00.000Z",
											windows: [{ ...window, usedPercent: 55 }],
										},
									},
								],
							},
						],
					},
				},
			],
		]);
		const [account] = collectLimitAccounts(input);
		expect(account?.limits.windows[0]?.usedPercent).toBe(55);
		expect(account?.limits.resetCredits?.availableCount).toBe(2);
		expect(account?.redeem).toEqual({ environmentId: "env-a", input: { instanceId: "claude" } });
		expect(account?.environments).toEqual([{ environmentId: "env-a", label: "Laptop" }]);
	});

	it("redeems through the hub when it holds a credit, even with a fresher native read", () => {
		const native = provider({
			driver: claude,
			instanceId: "claude",
			auth: { status: "authenticated", email: "same@example.com" },
			usageLimits: {
				checkedAt: "2026-09-03T11:30:00.000Z",
				windows: [{ ...window, usedPercent: 40 }],
				resetCredits: { availableCount: 3, nextCreditId: "native-credit" },
			},
		});
		const input = new Map([
			[
				"env-a",
				{
					...laptop,
					serverConfig: {
						providers: [native],
						usageLimitSources: [
							{
								...source,
								accounts: [
									{
										id: "claude-same@example.com.json",
										driver: claude,
										email: "same@example.com",
										usageLimits: {
											checkedAt,
											windows: [{ ...window, usedPercent: 55 }],
											resetCredits: { availableCount: 2, nextCreditId: "hub-credit" },
										},
									},
								],
							},
						],
					},
				},
			],
		]);
		const [account] = collectLimitAccounts(input);
		expect(account?.redeem).toEqual({
			environmentId: "env-a",
			input: { sourceId: "hub", accountId: "claude-same@example.com.json", creditId: "hub-credit" },
		});
		expect(account?.limits.resetCredits?.availableCount).toBe(3);
	});

	it("redeems on the environment whose snapshot supplied the credits on show", () => {
		const stale = provider({
			auth: { status: "authenticated", email: "same@example.com" },
			usageLimits: {
				checkedAt,
				windows: [window],
				resetCredits: { availableCount: 0 },
			},
		});
		const fresh = {
			...stale,
			usageLimits: {
				checkedAt: "2026-09-03T11:30:00.000Z",
				windows: [window],
				resetCredits: { availableCount: 2 },
			},
		};
		const input = new Map([
			["env-a", { ...laptop, serverConfig: { providers: [stale] } }],
			[
				"env-b",
				{ entry: { target: { label: "Desktop" } }, serverConfig: { providers: [fresh] } },
			],
		]);
		const [account] = collectLimitAccounts(input);
		expect(account?.limits.resetCredits?.availableCount).toBe(2);
		expect(account?.redeem).toEqual({ environmentId: "env-b", input: { instanceId: "codex" } });
	});

	it("keeps distinct hub accounts redeemable through their own source", () => {
		const hubAccounts = ["first", "second"].map((id) => ({
			id,
			driver: "codex",
			email: `${id}@example.com`,
			usageLimits: {
				checkedAt,
				windows: [window],
				resetCredits: { availableCount: 2, nextCreditId: `${id}-credit` },
			},
		}));
		const input = new Map([
			[
				"env-a",
				{
					...laptop,
					serverConfig: {
						providers: [],
						usageLimitSources: [{ ...source, accounts: hubAccounts }],
					},
				},
			],
		]);
		expect(collectLimitAccounts(input).map((account) => account.redeem)).toEqual(
			hubAccounts.map((account) => ({
				environmentId: "env-a",
				input: { sourceId: "hub", accountId: account.id, creditId: `${account.id}-credit` },
			})),
		);
	});

	it("does not give old credits the timestamp of a newer window-only read", () => {
		const snapshots = [
			{ checkedAt, windows: [window], resetCredits: { availableCount: 2 } },
			{ checkedAt: "2026-09-03T12:00:00.000Z", windows: [window] },
			{
				checkedAt: "2026-09-03T11:30:00.000Z",
				windows: [window],
				resetCredits: { availableCount: 1 },
			},
		];
		const input = new Map(
			snapshots.map((usageLimits, i) => [
				`env-${i}`,
				{
					...laptop,
					serverConfig: {
						providers: [
							provider({
								auth: { status: "authenticated", email: "same@example.com" },
								usageLimits,
							}),
						],
					},
				},
			]),
		);
		const [account] = collectLimitAccounts(input);
		expect(account?.limits.checkedAt).toBe("2026-09-03T12:00:00.000Z");
		expect(account?.limits.resetCredits?.availableCount).toBe(1);
		expect(account?.redeem?.environmentId).toBe("env-2");
	});

	it("keeps one email in two workspaces apart while merging each workspace's duplicates", () => {
		const login = (instanceId: string, workspaceId: string, usedPercent: number) =>
			provider({
				instanceId: instanceId,
				auth: { status: "authenticated", email: "same@example.com", workspaceId },
				usageLimits: { checkedAt, windows: [{ ...weekly, usedPercent }] },
			});
		const hubAccount = (id: string, workspaceId?: string) => ({
			id,
			driver: "codex",
			email: "same@example.com",
			...(workspaceId ? { workspaceId } : {}),
			usageLimits: { checkedAt, windows: [{ ...weekly, usedPercent: 50 }] },
		});
		const input = new Map([
			[
				"env-a",
				{
					...laptop,
					serverConfig: {
						providers: [login("business", "ws-business", 8), login("personal", "ws-plus", 26)],
						usageLimitSources: [
							{ ...source, accounts: [hubAccount("plus.json", "ws-plus"), hubAccount("x.json")] },
						],
					},
				},
			],
			[
				"env-b",
				{
					entry: { target: { label: "Desktop" } },
					serverConfig: { providers: [login("personal", "ws-plus", 26)] },
				},
			],
		]);
		const accounts = collectLimitAccounts(input);
		expect(accounts.map((account) => account.key)).toEqual([
			"env-a:business",
			"env-a:personal",
			"hub:x.json",
		]);
		expect(accounts[0]?.limits.windows[0]?.usedPercent).toBe(8);
		const withoutEmail = (id: string, workspaceId: string) => {
			const { email: _email, ...account } = hubAccount(id, workspaceId);
			return account;
		};
		const sameFile = new Map([
			[
				"env-a",
				{
					...laptop,
					serverConfig: {
						providers: [],
						usageLimitSources: [{ ...source, accounts: [withoutEmail("a.json", "ws-1")] }],
					},
				},
			],
			[
				"env-b",
				{
					...laptop,
					serverConfig: {
						providers: [],
						usageLimitSources: [{ ...source, accounts: [withoutEmail("a.json", "ws-2")] }],
					},
				},
			],
		]);
		expect(collectLimitAccounts(sameFile).map((account) => account.key)).toEqual([
			"hub:a.json:ws-1",
			"hub:a.json:ws-2",
		]);
		expect(accounts[1]?.environments.map((environment) => environment.label)).toEqual([
			"Laptop",
			"Desktop",
		]);
	});

	it("joins a report without a workspace to the only workspace signed in with its email", () => {
		const native = provider({
			driver: claude,
			auth: { status: "authenticated", email: "same@example.com", workspaceId: "org-a" },
			usageLimits: { checkedAt, windows: [window] },
		});
		const hubAccount = {
			id: "claude.json",
			driver: claude,
			email: "same@example.com",
			usageLimits: { checkedAt, windows: [window] },
		};
		const withOther = (other: LimitProvider) =>
			new Map([
				[
					"env-a",
					{
						...laptop,
						serverConfig: {
							providers: [native, other],
							usageLimitSources: [{ ...source, accounts: [hubAccount] }],
						},
					},
				],
			]);
		const unrelated = provider({ instanceId: "codex-2" });
		expect(collectLimitAccounts(withOther(unrelated)).map((account) => account.key)).toEqual([
			"env-a:codex",
		]);
		const unreadable = provider({
			...native,
			instanceId: "team",
			auth: { ...native.auth, workspaceId: "org-b" },
			usageLimits: { checkedAt, windows: [], unavailable: { reason: "probeFailed" } },
		});
		expect(collectLimitAccounts(withOther(unreadable)).map((account) => account.key)).toEqual([
			"env-a:codex",
			"hub:claude.json",
		]);
	});

	it("keys a hub account without an email by hub, so two environments on one hub share it", () => {
		const seat = {
			id: "claude-team-seat.json",
			driver: claude,
			usageLimits: { checkedAt, windows: [window] },
		};
		const hub = { ...source, accounts: [seat] };
		const input = new Map([
			[
				"env-a",
				{ ...laptop, serverConfig: { providers: [], usageLimitSources: [hub] } },
			],
			[
				"env-b",
				{
					entry: { target: { label: "Desktop" } },
					serverConfig: { providers: [], usageLimitSources: [hub] },
				},
			],
		]);
		const accounts = collectLimitAccounts(input);
		expect(accounts.map((account) => account.key)).toEqual(["hub:claude-team-seat.json"]);
		expect(accounts[0]?.displayName).toBe("claude-team-seat");
	});

	it("pools Codex windows by kind, whichever slot reported them", () => {
		const codexAccount = (id: string, slots: readonly string[]) => ({
			id,
			driver: "codex",
			usageLimits: {
				checkedAt,
				windows: slots.map((slot) => ({ ...weekly, id: slot, usedPercent: 50 })),
			},
		});
		const pooled = (accounts: ReturnType<typeof codexAccount>[]) =>
			collectLimitPools(
				collectLimitAccounts(
					new Map([
						[
							"env-a",
							{
								...laptop,
								serverConfig: { providers: [], usageLimitSources: [{ ...source, accounts }] },
							},
						],
					]),
				),
				now,
			)[0]?.windows ?? [];
		for (const order of [
			[codexAccount("business", ["primary"]), codexAccount("plus", ["secondary"])],
			[codexAccount("plus", ["secondary"]), codexAccount("business", ["primary"])],
		]) {
			const windows = pooled(order);
			expect(windows.map((window) => window.id)).toEqual(["weekly"]);
			expect(windows[0]?.members).toHaveLength(2);
		}
		expect(
			pooled([codexAccount("a", ["secondary"]), codexAccount("b", ["primary", "secondary"])]).map(
				(window) => window.id,
			),
		).toEqual(["weekly", "weekly:secondary"]);
	});

	it("pools windows by id across accounts and orders resets by when they land", () => {
		const input = new Map([
			[
				"env-a",
				{
					...laptop,
					serverConfig: {
						providers: [],
						usageLimitSources: [
							{
								...source,
								accounts: [
									{
										id: "a",
										driver: claude,
										usageLimits: {
											checkedAt,
											windows: [
												{ ...window, usedPercent: 80, resetsAt: "2026-09-03T13:00:00.000Z" },
												{ ...weekly, usedPercent: 20 },
											],
										},
									},
									{
										id: "b",
										driver: claude,
										usageLimits: {
											checkedAt,
											windows: [{ ...window, usedPercent: 40 }],
										},
									},
									{
										id: "c",
										driver: "codex",
										usageLimits: { checkedAt, windows: [{ ...weekly, usedPercent: 50 }] },
									},
									{
										id: "unsupported",
										driver: claude,
										usageLimits: {
											checkedAt,
											windows: [],
											unavailable: { reason: "unsupported" as const },
										},
									},
								],
							},
						],
					},
				},
			],
		]);
		const pools = collectLimitPools(collectLimitAccounts(input), now);
		expect(pools.map((pool) => [pool.driver, pool.accounts.length])).toEqual([
			["claudeAgent", 2],
			["codex", 1],
		]);
		const [session, week] = pools[0]!.windows;
		const untimed = collectLimitPools(
			collectLimitAccounts(input).map((account) =>
				account.key === "hub:b"
					? {
							...account,
							limits: {
								...account.limits,
								windows: account.limits.windows.map((w) => ({ ...w, resetsAt: undefined })),
							},
						}
					: account,
			),
			now,
		);
		expect(untimed[0]?.windows[0]?.pace).toBe("on");
		expect(session).toMatchObject({
			id: "five_hour",
			remainingPercent: 40,
			usedPercent: 60,
			pace: "under",
		});
		expect(
			session?.resets.map((reset) => [reset.member.account.key, reset.restoresPercent]),
		).toEqual([
			["hub:a", 40],
			["hub:b", 20],
		]);
		expect(week).toMatchObject({ id: "seven_day", remainingPercent: 80, members: [{}] });
		// Codex reports `primary` for both its five-hour and (on Go) monthly window.
		const mixed = collectLimitPools(
			[
				...collectLimitAccounts(input),
				{
					key: "go",
					driver: claude,
					displayName: "Go",
					email: undefined,
					plan: undefined,
					accentColor: undefined,
					environments: [],
					sourceLabel: null,
					redeem: null,
					limits: {
						checkedAt,
						windows: [
							{
								id: "five_hour",
								kind: "monthly",
								label: "Monthly",
								usedPercent: 82,
								windowDurationMins: 30 * 24 * 60,
								resetsAt: "2026-09-14T12:00:00.000Z",
							},
						],
					},
				},
			],
			now,
		);
		expect(mixed[0]?.windows.map((window) => [window.kind, window.members.length])).toEqual([
			["session", 2],
			["weekly", 1],
			["monthly", 1],
		]);
		expect(session?.members.map((member) => member.account.key)).toEqual(["hub:a", "hub:b"]);
		expect(pools[0]?.accounts.map((account) => account.key)).toEqual(["hub:a", "hub:b"]);
	});
});

describe("pooled account columns", () => {
	const weekly = {
		...window,
		id: "seven_day",
		kind: "weekly",
		label: "Weekly",
		windowDurationMins: 7 * 24 * 60,
	} as const;
	const account = (key: string, windows: LimitAccount["limits"]["windows"]): LimitAccount => ({
		key,
		driver: "claudeAgent",
		displayName: key,
		email: undefined,
		plan: undefined,
		accentColor: undefined,
		environments: [],
		sourceLabel: "Hub",
		redeem: null,
		limits: { checkedAt: "2026-09-03T11:00:00.000Z", windows },
	});
	const keys = (pool: ReturnType<typeof collectLimitPools>[number]) =>
		pool.windows.map((row) =>
			row.columns.map((member) => (member.window ? member.account.key : null)),
		);

	// regression: #20349 sessions stay visible while the weekly quota is exhausted
	it.each([
		["claudeAgent", "13:00", 40, "14:00", 100],
		["codex", "14:00", 100, "14:00", 100],
		["claudeAgent", "15:00", 100, "15:00", 100],
		["codex", "15:00", 40, "14:00", 60],
	] as const)(
		"%s session resetting at %s with %i percent spent becomes usable at %s with %i percent restored",
		(driver, sessionReset, usedPercent, usableAt, restoresPercent) => {
			const at = (time: string) => `2026-09-03T${time}:00.000Z`;
			const a = {
				...account("a", [
					{
						...window,
						id: driver === "codex" ? "primary" : window.id,
						usedPercent,
						resetsAt: at(sessionReset),
					},
					{
						...weekly,
						id: driver === "codex" ? "secondary" : weekly.id,
						usedPercent: 100,
						resetsAt: at("14:00"),
					},
				]),
				driver: driver,
			};
			const [session] = collectLimitPools([a], now)[0]!.windows;
			expect.soft(session?.remainingPercent).toBe(0);
			expect(session?.resets[0]).toMatchObject({
				at: Date.parse(at(usableAt)),
				restoresPercent,
			});
		},
	);

	it("excludes weekly-blocked sessions from the pool without changing snapshots or model allowances", () => {
		const blocked = account("blocked", [
			window,
			{ ...weekly, usedPercent: 100 },
			{ ...weekly, id: "seven_day_fable", usedPercent: 20 },
		]);
		const accounts = [
			blocked,
			account("available", [
				{ ...window, usedPercent: 20 },
				{ ...weekly, usedPercent: 99 },
				{ ...weekly, id: "seven_day_fable", usedPercent: 40 },
			]),
			{ ...blocked, key: "cursor", driver: "cursor" },
		];
		const snapshot = structuredClone(accounts);
		const [claude, cursor] = collectLimitPools(accounts, now);
		expect.soft(claude?.windows.map((row) => row.remainingPercent)).toEqual([40, 1, 70]);
		expect.soft(cursor?.windows.map((row) => row.remainingPercent)).toEqual([60, 0, 80]);
		expect(accounts).toEqual(snapshot);
	});

	it("keeps session columns across rows with opposite reset and usage orders", () => {
		const accounts = [
			account("a", [
				{ ...weekly, usedPercent: 80, resetsAt: "2026-09-05T12:00:00.000Z" },
				{ ...window, usedPercent: 10, resetsAt: "2026-09-03T15:00:00.000Z" },
			]),
			account("b", [
				{ ...weekly, usedPercent: 20, resetsAt: "2026-09-06T12:00:00.000Z" },
				{ ...window, usedPercent: 90, resetsAt: "2026-09-03T13:00:00.000Z" },
			]),
		];
		const [pool] = collectLimitPools(accounts, now);
		expect(pool!.accounts.map((account) => account.key)).toEqual(["b", "a"]);
		expect(keys(pool!)).toEqual([
			["b", "a"],
			["b", "a"],
		]);
		expect(pool!.windows[1]!.resets.map((reset) => reset.member.account.key)).toEqual(["a", "b"]);
		expect(pool!.windows[1]!.remainingPercent).toBe(50);
		expect(keys(collectLimitPools(accounts.toReversed(), now)[0]!)).toEqual(keys(pool!));
	});

	it.each([undefined, "invalid", "2026-09-03T11:30:00.000Z"])(
		"keeps blocked sessions empty without predicting a refill from a missing or stale clock (%s)",
		(resetsAt) => {
			const [pool] = collectLimitPools(
				[
					account("session-clock", [
						{ ...window, resetsAt },
						{ ...weekly, usedPercent: 100 },
					]),
					account("weekly-clock", [window, { ...weekly, usedPercent: 100, resetsAt }]),
				],
				now,
			);
			expect(pool!.windows[0]).toMatchObject({ remainingPercent: 0, pace: null, resets: [] });
			expect(pool!.windows[0]!.columns.map((column) => column.window?.resetsAt)).toEqual([
				undefined,
				undefined,
			]);
		},
	);

	it("orders by usable session refill and clears suppression after a fresh weekly reading", () => {
		const blocked = account("blocked", [
			{ ...window, resetsAt: "2026-09-03T13:00:00.000Z" },
			{ ...weekly, usedPercent: 100, resetsAt: "2026-09-03T15:00:00.000Z" },
		]);
		const available = account("available", [window]);
		const [before] = collectLimitPools([blocked, available], now);
		expect(before!.accounts.map((account) => account.key)).toEqual(["available", "blocked"]);
		expect(before!.windows[0]!.remainingPercent).toBe(30);
		const refreshed = {
			...blocked,
			limits: {
				checkedAt: "2026-09-03T12:00:00.000Z",
				windows: [blocked.limits.windows[0]!, { ...weekly, usedPercent: 10 }],
			},
		};
		const [after] = collectLimitPools([refreshed, available], now);
		expect(after!.accounts.map((account) => account.key)).toEqual(["blocked", "available"]);
		expect(after!.windows[0]!.remainingPercent).toBe(60);
		expect(after!.windows[0]!.resets[0]).toMatchObject({
			at: Date.parse("2026-09-03T13:00:00.000Z"),
			restoresPercent: 20,
		});
	});

	it("preserves gaps without counting missing windows toward pooled quota", () => {
		const [pool] = collectLimitPools(
			[
				account("a", [window]),
				account("b", [
					{ ...window, resetsAt: "2026-09-03T15:00:00.000Z" },
					{ ...weekly, usedPercent: 80 },
				]),
				account("c", [weekly]),
			],
			now,
		);
		expect(keys(pool!)).toEqual([
			["a", "b", null],
			[null, "b", "c"],
		]);
		expect(pool!.windows[1]!.members.map((member) => member.account.key)).toEqual(["b", "c"]);
		expect(pool!.windows[1]!.remainingPercent).toBe(40);
		expect(pool!.windows[1]!.resets.map((reset) => reset.restoresPercent)).toEqual([40, 20]);
	});

	it("falls back to weekly resets when no account reports a session", () => {
		const [pool] = collectLimitPools(
			[
				account("a", [{ ...weekly, resetsAt: "2026-09-06T12:00:00.000Z" }]),
				account("b", [{ ...weekly, resetsAt: "2026-09-05T12:00:00.000Z" }]),
			],
			now,
		);
		expect(keys(pool!)).toEqual([["b", "a"]]);
	});
});

describe("staleness, as T3 Code's widget judges it", () => {
	const account = (checkedAt: string, resetsAt?: string): LimitAccount => ({
		key: checkedAt,
		driver: "codex",
		displayName: null,
		email: undefined,
		plan: undefined,
		accentColor: undefined,
		environments: [],
		sourceLabel: null,
		redeem: null,
		limits: { checkedAt, windows: [{ ...window, ...(resetsAt === undefined ? { resetsAt: undefined } : { resetsAt }) }] },
	});

	it("expires 15 minutes after the oldest read, or at the first reset if sooner", () => {
		const [pool] = collectLimitPools([account("2026-09-03T11:50:00.000Z"), account("2026-09-03T11:55:00.000Z")], now);
		expect(new Date(limitsExpireAt(pool!)).toISOString()).toBe("2026-09-03T12:05:00.000Z");
		expect(limitsStale(pool!, now)).toBe(false);
		expect(limitsStale(pool!, Date.parse("2026-09-03T12:05:00.000Z"))).toBe(true);
		const [soon] = collectLimitPools([account("2026-09-03T11:59:00.000Z", "2026-09-03T12:01:00.000Z")], now);
		expect(limitsStale(soon!, Date.parse("2026-09-03T12:02:00.000Z"))).toBe(true);
	});

	it("counts an unreadable read time as stale", () => {
		const [pool] = collectLimitPools([account("not a time")], now);
		expect(limitsStale(pool!, now)).toBe(true);
	});
});
