import streamDeck, { type Action, action, type DialAction, type DidReceiveSettingsEvent, type KeyDownEvent, type KeyUpEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { HOLD_CONFIRM_MS } from "../core/approvals.js";
import { openExternal } from "../core/commands.js";
import { failureLabel } from "../core/feedback.js";
import { gaugeStripArt, renderGaugeKey } from "../core/gauge.js";
import { t } from "../core/i18n.js";
import { providerDisplayName, providerMark } from "../core/models.js";
import { COLORS, glyphArt, type MarkPainter, renderInfoKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants, needsAccessLabel } from "../core/scopes.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { PROVIDERS_SCOPE } from "../core/t3/pairing.js";
import { type LimitPool, limitsStale } from "../core/usage/limits.js";
import {
	accountName,
	creditsText,
	findWindow,
	type LimitGauge,
	limitGauge,
	limitPools,
	limitTiles,
	type LimitTile,
	limitsShow,
	outcomeText,
	resetAction,
	resetTarget,
	resetText,
	windowChoices,
} from "../core/usage/limitsView.js";
import { LimitsRefresher } from "../core/usage/refresh.js";
import { deck } from "../deck.js";
import { connectionFace, DeckAction, pressWhileDisconnected } from "./base.js";
import { connectionOf } from "./needs.js";
import { type DialSettings, disconnectedStrip, StripDial } from "./strip.js";

const ID = "com.alejandrom2.t3deck";
const logger = streamDeck.logger.createScope("limits");

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The ready machines an instance following `url` (or every machine) reads limits from. */
const readyMachines = (url: string | undefined): Machine[] =>
	deck.machines.filter((machine) => machine.state.kind === "ready" && machine.environmentId !== undefined && (url === undefined || machine.url === url));

const pools = (url: string | undefined, now = Date.now()): readonly LimitPool[] =>
	limitPools(
		readyMachines(url).map((machine) => ({
			environmentId: machine.environmentId!,
			label: machine.state.kind === "ready" ? machine.state.label : machine.url,
			providers: machine.modelConfig?.providers,
			sources: machine.limitSources,
		})),
		now,
	);

const providerName = (driver: string) => providerDisplayName({ instanceId: driver, driver });

const mark =
	(driver: string): MarkPainter =>
	(x, y, size) =>
		providerMark({ driver, providerName: providerName(driver), accentColor: undefined, iconUrl: undefined, badge: false }, x, y, size);

/**
 * Which machines visible Limits instances read, kept on the config subscription meanwhile. Limits refresh when an
 * instance shows them, when they go stale (T3 Code's widget rule) and on a press, through T3 Code's throttle; a
 * minute tick re-checks staleness and redraws while any shows, and nothing runs while none does.
 */
class LimitsWatch {
	readonly refresher = new LimitsRefresher();
	readonly #shown = new Map<string, string | undefined>();
	readonly #watched = new Map<string, () => void>();
	readonly #painters = new Set<() => void>();
	#tick: ReturnType<typeof setInterval> | undefined;

	show(id: string, url: string | undefined): void {
		this.#shown.set(id, url);
		this.sync(true);
	}

	hide(id: string): void {
		this.#shown.delete(id);
		this.sync();
	}

	onTick(paint: () => void): void {
		this.#painters.add(paint);
	}

	/** Watches what visible instances read; newly watched machines (or all, on `appeared`) get an automatic refresh. */
	sync(appeared = false): void {
		const urls = [...this.#shown.values()];
		const wanted = new Map(readyMachines(undefined).filter((machine) => urls.some((url) => url === undefined || url === machine.url)).map((machine) => [machine.url, machine]));
		for (const [url, release] of this.#watched) {
			if (wanted.has(url)) continue;
			release();
			this.#watched.delete(url);
		}
		for (const [url, machine] of wanted) {
			const fresh = !this.#watched.has(url);
			if (fresh) this.#watched.set(url, machine.watchConfig());
			if (fresh || appeared) this.#automatic(machine);
		}
		if (this.#shown.size === 0) {
			clearInterval(this.#tick);
			this.#tick = undefined;
		} else this.#tick ??= setInterval(() => this.#onTick(), 60_000);
	}

	/**
	 * Re-reads one machine's limits. Automatic refreshes keep to T3 Code's five-minute gap; a manual one shares a refresh
	 * in flight, or with `after` runs again once it ends, as after spending a reset.
	 */
	refresh(machine: Machine, automatic: boolean, after = false): Promise<void> {
		const environmentId = machine.environmentId;
		if (environmentId === undefined) return Promise.resolve();
		const done = this.refresher.refresh(environmentId, () => machine.refreshProviders(), automatic, after).then(() => undefined);
		deck.repaint();
		return done.finally(() => deck.repaint());
	}

	#automatic(machine: Machine): void {
		void this.refresh(machine, true).catch((error: unknown) => logger.warn(`Refreshing limits failed: ${message(error)}`));
	}

	refreshing(url: string | undefined): boolean {
		return readyMachines(url).some((machine) => machine.environmentId !== undefined && this.refresher.pending(machine.environmentId));
	}

	#onTick(): void {
		const now = Date.now();
		for (const machine of readyMachines(undefined)) {
			if (!this.#watched.has(machine.url)) continue;
			if (pools(machine.url, now).some((pool) => limitsStale(pool, now))) this.#automatic(machine);
		}
		for (const paint of this.#painters) paint();
	}
}

const watch = new LimitsWatch();
deck.onRepaint(() => watch.sync());

/** A manual refresh of every machine an instance reads; resolves when all are back. */
const refreshAll = (url: string | undefined) => Promise.all(readyMachines(url).map((machine) => watch.refresh(machine, false)));

type LimitsSettings = { machine?: string; provider?: string; window?: string; show?: string; resetAction?: string };

/** The machine a reset for `pool` spends on, and the account; undefined when no account has one to spend. */
function resetPlan(pool: LimitPool) {
	const account = resetTarget(pool);
	if (account?.redeem == null) return undefined;
	const machine = readyMachines(undefined).find((candidate) => candidate.environmentId === account.redeem!.environmentId);
	return machine === undefined ? undefined : { account, machine, redeem: account.redeem };
}

/**
 * A hold's reset action: open T3 Code's Usage page, or spend one banked credit on the account T3 Code would refill
 * first. Spending needs provider access on that machine; without it the machine's next pairing asks for it.
 */
async function useReset(pool: LimitPool | undefined, settings: LimitsSettings): Promise<{ ok: boolean; label: string }> {
	if (resetAction(settings.resetAction) === "open") {
		// T3 Code has no Usage link yet; this brings the app forward, and lands on Usage once it routes one.
		await openExternal(`${deck.scheme}://usage`);
		return { ok: true, label: t("result.opened") };
	}
	const plan = pool && resetPlan(pool);
	if (plan === undefined) return { ok: false, label: t("limits.noResets") };
	if (!grants(plan.machine.scopes, PROVIDERS_SCOPE)) {
		await deck.optInScope(plan.machine.url, PROVIDERS_SCOPE);
		return { ok: false, label: needsAccessLabel(PROVIDERS_SCOPE) };
	}
	try {
		const result = await plan.machine.consumeResetCredit(plan.redeem.input);
		return { ok: result.outcome === "reset", label: `${accountName(plan.account)}: ${outcomeText(result)}` };
	} catch (error) {
		logger.warn(`Using a reset failed: ${message(error)}`);
		return { ok: false, label: failureLabel(error) };
	} finally {
		void watch.refresh(plan.machine, false, true).catch(() => undefined);
	}
}

/** Flags provider access on the machine a "spend" instance would spend on, so its next pairing asks for it. */
function optInFor(url: string | undefined, settings: LimitsSettings): void {
	if (resetAction(settings.resetAction) !== "spend") return;
	const machines = readyMachines(url).filter((machine) => !grants(machine.scopes, PROVIDERS_SCOPE));
	const targets = new Set(pools(url).flatMap((pool) => resetPlan(pool)?.machine.url ?? []));
	for (const machine of machines) if (targets.size === 0 ? url !== undefined : targets.has(machine.url)) void deck.optInScope(machine.url, PROVIDERS_SCOPE);
}

/** The checklist's provider access line for a "spend" instance: met when every machine it could spend on has it. */
function spendNeeds(url: string | undefined, settings: LimitsSettings): Need[] {
	if (resetAction(settings.resetAction) !== "spend") return [];
	const machines = readyMachines(url);
	return [{ kind: "scope", scope: PROVIDERS_SCOPE, ok: machines.length > 0 && machines.every((machine) => grants(machine.scopes, PROVIDERS_SCOPE)) }];
}

/**
 * The gauge's two gray lines: when it resets (or that it needs a refresh), and the banked resets, or in amber that
 * spending them needs provider access the pool's machine lacks.
 */
function gaugeLines(gauge: LimitGauge, pool: LimitPool, url: string | undefined, settings: LimitsSettings, now: number): [string, string | { text: string; color: string }] {
	const first = watch.refreshing(url) ? t("limits.refreshing") : gauge.stale ? t("limits.pressToRefresh") : gauge.resetAt === undefined ? "" : resetText(gauge.resetAt, now);
	const plan = resetAction(settings.resetAction) === "spend" ? resetPlan(pool) : undefined;
	if (plan !== undefined && !grants(plan.machine.scopes, PROVIDERS_SCOPE)) return [first, { text: t("limits.needsProviders"), color: COLORS.attention }];
	return [first, creditsText(gauge.credits)];
}

const lineText = (line: string | { text: string }) => (typeof line === "string" ? line : line.text);

/**
 * One provider's limit window, pooled across its accounts on the key's machine or every machine: % left (or used)
 * with a bar, the next reset and the resets banked. A tap refreshes; a hold opens T3 Code's Usage page or, when set,
 * spends a banked reset.
 */
@action({ UUID: `${ID}.limits` })
export class LimitsKey extends DeckAction<LimitsSettings> {
	constructor() {
		super();
		watch.onTick(() => this.#paintShown());
	}

	#state(action: Action<LimitsSettings>) {
		const url = this.machineOf(action);
		const settings = this.settingsOf(action);
		const all = pools(url);
		const pool = settings.provider ? all.find((candidate) => candidate.driver === settings.provider) : all[0];
		return { url, settings, all, pool, window: pool && findWindow(pool, settings.window) };
	}

	protected override async paint(action: Action<LimitsSettings>): Promise<void> {
		if (!action.isKey()) return;
		const offline = connectionFace(this.machineOf(action));
		if (offline) return void (await this.setImage(action, offline));
		const { url, settings, all, pool, window } = this.#state(action);
		if (all.length === 0) return void (await this.setImage(action, renderInfoKey({ glyph: "gauge", title: t("limits.title"), detail: t("limits.none"), available: false })));
		if (pool === undefined || window === undefined) {
			const missing = pool === undefined ? providerName(settings.provider ?? "") : (settings.window ?? "");
			return void (await this.setImage(action, renderInfoKey({ glyph: "gauge", title: t("limits.title"), detail: t("needs.notAvailable", { value: missing }), available: false })));
		}
		const now = Date.now();
		const show = limitsShow(settings.show);
		const gauge = limitGauge(pool, window, now, show);
		await this.setImage(
			action,
			renderGaugeKey({
				mark: mark(pool.driver),
				label: gauge.label,
				value: `${gauge.percent}%`,
				lines: gaugeLines(gauge, pool, url, settings, now),
				fill: gauge.percent / 100,
				...(gauge.pace === undefined ? {} : { marker: gauge.pace / 100 }),
				dim: gauge.stale,
			}),
		);
	}

	override onWillAppear(ev: WillAppearEvent<LimitsSettings>): void {
		super.onWillAppear(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
		optInFor(this.machineOf(ev.action), this.settingsOf(ev.action));
	}

	override onWillDisappear(ev: WillDisappearEvent<LimitsSettings>): void {
		watch.hide(ev.action.id);
		super.onWillDisappear(ev);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<LimitsSettings>): Promise<void> {
		super.onDidReceiveSettings(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
		optInFor(this.machineOf(ev.action), this.settingsOf(ev.action));
		if (streamDeck.ui.action?.id === ev.action.id) await this.#sendWindows(ev.action);
	}

	#paintShown(): void {
		for (const instance of this.actions) void this.paint(instance);
	}

	override onKeyDown(ev: KeyDownEvent<LimitsSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<LimitsSettings>): Promise<void> {
		const held = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { url, settings, pool } = this.#state(ev.action);
		if (held >= HOLD_CONFIRM_MS) {
			const result = await useReset(pool, settings);
			return this.flash(ev.action, result.ok, result.label);
		}
		const refreshing = refreshAll(url);
		if (resetAction(settings.resetAction) === "spend" && pool !== undefined && resetTarget(pool) !== undefined) await this.flash(ev.action, false, t("limits.holdToReset"));
		await this.apply(ev.action, () => refreshing);
	}

	/** The Provider and Window settings' choices: the providers reporting limits on the key's machines, and the chosen one's windows. */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, LimitsSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event === "getLimitProviders") return this.#sendProviders(ev.action);
		if (payload?.event === "getLimitWindows") return this.#sendWindows(ev.action);
		return super.onSendToPlugin(ev);
	}

	async #sendProviders(action: Action<LimitsSettings>): Promise<void> {
		const all = pools(this.machineOf(action));
		const items = [{ label: t("datasource.firstProvider"), value: "" }, ...all.map((pool) => ({ label: providerName(pool.driver), value: pool.driver }))];
		const saved = this.settingsOf(action).provider;
		if (saved && !all.some((pool) => pool.driver === saved)) items.push({ label: t("needs.notAvailable", { value: providerName(saved) }), value: saved });
		await streamDeck.ui.sendToPropertyInspector({ event: "getLimitProviders", items });
	}

	async #sendWindows(action: Action<LimitsSettings>): Promise<void> {
		const { settings, pool } = this.#state(action);
		const choices = pool ? windowChoices(pool) : [];
		const items = [{ label: t("datasource.firstWindow"), value: "" }, ...choices];
		if (settings.window && !choices.some((choice) => choice.value === settings.window)) items.push({ label: t("needs.notAvailable", { value: settings.window }), value: settings.window });
		await streamDeck.ui.sendToPropertyInspector({ event: "getLimitWindows", items });
	}

	override needs(action: Action<LimitsSettings>): Need[] {
		const { url, settings, all, pool, window } = this.#state(action);
		const ready = connectionOf(url) === "ready";
		return [
			{ kind: "paired", connection: connectionOf(url) },
			{ kind: "limits", ok: ready ? all.length > 0 : false },
			...(ready && settings.provider ? [{ kind: "value", value: providerName(settings.provider), ok: pool !== undefined } satisfies Need] : []),
			...(ready && pool && settings.window ? [{ kind: "value", value: settings.window, ok: window !== undefined } satisfies Need] : []),
			...spendNeeds(url, settings),
		];
	}
}

type LimitsDialSettings = DialSettings & { show?: string; resetAction?: string };

/**
 * Turns through every provider's limit windows, pooled like T3 Code's Limits page. Press or tap refreshes; holding
 * the press opens T3 Code's Usage page or, when set, spends a banked reset on the shown provider.
 */
@action({ UUID: `${ID}.dial.limits` })
export class LimitsDial extends StripDial<LimitsDialSettings> {
	readonly #selected = new Map<string, string>();

	constructor() {
		super();
		watch.onTick(() => this.#paintShown());
	}

	#tiles(action: Action<LimitsDialSettings>): { tiles: LimitTile[]; index: number } {
		const tiles = limitTiles(pools(this.machineOf(action)));
		const index = Math.max(0, tiles.findIndex((tile) => tile.key === this.#selected.get(action.id)));
		return { tiles, index };
	}

	#gauge(action: Action<LimitsDialSettings>, tile: LimitTile, now: number) {
		return limitGauge(tile.pool, tile.window, now, limitsShow(this.settingsOf(action).show));
	}

	protected face(action: Action<LimitsDialSettings>): StripContent {
		const offline = disconnectedStrip(t("limits.title"), this.machineOf(action));
		if (offline) return offline;
		const { tiles, index } = this.#tiles(action);
		const tile = tiles[index];
		if (tile === undefined) return { header: t("limits.title"), icon: glyphArt("gauge", COLORS.muted), accent: COLORS.muted, value: t("limits.none"), detail: t("limits.noneDetail") };
		const now = Date.now();
		const gauge = this.#gauge(action, tile, now);
		const [when, credits] = gaugeLines(gauge, tile.pool, this.machineOf(action), this.settingsOf(action), now).map(lineText);
		const reset = gauge.resetAt === undefined || gauge.resetAt <= now ? "" : t("limits.resetsIn", { time: resetText(gauge.resetAt, now) });
		return {
			header: providerName(tile.pool.driver),
			icon: mark(tile.pool.driver),
			accent: COLORS.accent,
			value: `${gauge.label} · ${gauge.percent}%`,
			detail: [gauge.stale ? when : reset || when, credits, gauge.accounts > 1 ? t("limits.pooled", { count: gauge.accounts }) : ""].filter(Boolean).join(" · "),
		};
	}

	protected override picture(action: Action<LimitsDialSettings>): string | undefined {
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
		const { tiles, index } = this.#tiles(action);
		const tile = tiles[index];
		if (tile === undefined) return undefined;
		const now = Date.now();
		const gauge = this.#gauge(action, tile, now);
		const [when, credits] = gaugeLines(gauge, tile.pool, this.machineOf(action), this.settingsOf(action), now);
		return gaugeStripArt({
			mark: mark(tile.pool.driver),
			label: gauge.label,
			value: `${gauge.percent}%`,
			lines: typeof credits === "string" ? [[when, credits].filter(Boolean).join(" · ")] : [when, credits],
			fill: gauge.percent / 100,
			...(gauge.pace === undefined ? {} : { marker: gauge.pace / 100 }),
			dim: gauge.stale,
			footer: gauge.accounts > 1 ? `${providerName(tile.pool.driver)} · ${t("limits.pooled", { count: gauge.accounts })}` : providerName(tile.pool.driver),
			position: tiles.length > 1 ? `${index + 1}/${tiles.length}` : "",
		});
	}

	protected override list(action: Action<LimitsDialSettings>): StripList | undefined {
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
		const { tiles, index } = this.#tiles(action);
		if (tiles.length === 0) return undefined;
		const now = Date.now();
		const shown = this.#gauge(action, tiles[index]!, now);
		const [when, credits] = gaugeLines(shown, tiles[index]!.pool, this.machineOf(action), this.settingsOf(action), now).map(lineText);
		return {
			heading: t("limits.title"),
			items: tiles.map((tile) => {
				const gauge = this.#gauge(action, tile, now);
				return { key: tile.key, label: `${providerName(tile.pool.driver)} · ${gauge.label} · ${gauge.percent}%`, art: mark(tile.pool.driver), caption: `${gauge.percent}%` };
			}),
			index,
			note: { text: [when, credits].filter(Boolean).join(" · ") || shown.label },
		};
	}

	protected override rotated(dial: DialAction<LimitsDialSettings>, ticks: number): void {
		const { tiles, index } = this.#tiles(dial);
		if (tiles.length === 0) return;
		const next = tiles[(((index + ticks) % tiles.length) + tiles.length) % tiles.length]!;
		this.#selected.set(dial.id, next.key);
	}

	protected override async pressed(dial: DialAction<LimitsDialSettings>, held: number): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		if (held >= HOLD_CONFIRM_MS) {
			const { tiles, index } = this.#tiles(dial);
			const result = await useReset(tiles[index]?.pool, this.settingsOf(dial));
			return this.flash(dial, result.ok, result.label);
		}
		await this.#refresh(dial);
	}

	protected override async tapped(dial: DialAction<LimitsDialSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		await this.#refresh(dial);
	}

	async #refresh(dial: DialAction<LimitsDialSettings>): Promise<void> {
		const settings = this.settingsOf(dial);
		const { tiles, index } = this.#tiles(dial);
		const pool = tiles[index]?.pool;
		const refreshing = refreshAll(this.machineOf(dial));
		if (resetAction(settings.resetAction) === "spend" && pool !== undefined && resetTarget(pool) !== undefined) await this.flash(dial, false, t("limits.holdToReset"));
		await this.apply(dial, () => refreshing);
	}

	override onWillAppear(ev: WillAppearEvent<LimitsDialSettings>): void {
		super.onWillAppear(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
		optInFor(this.machineOf(ev.action), this.settingsOf(ev.action));
	}

	override onWillDisappear(ev: WillDisappearEvent<LimitsDialSettings>): void {
		watch.hide(ev.action.id);
		this.#selected.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<LimitsDialSettings>): void {
		super.onDidReceiveSettings(ev);
		watch.show(ev.action.id, this.machineOf(ev.action));
		optInFor(this.machineOf(ev.action), this.settingsOf(ev.action));
	}

	#paintShown(): void {
		for (const instance of this.actions) void this.paint(instance);
	}

	override needs(action: Action<LimitsDialSettings>): Need[] {
		const url = this.machineOf(action);
		const ready = connectionOf(url) === "ready";
		return [{ kind: "paired", connection: connectionOf(url) }, { kind: "limits", ok: ready ? pools(url).length > 0 : false }, ...spendNeeds(url, this.settingsOf(action))];
	}
}
