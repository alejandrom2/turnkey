import streamDeck, { type Action, action, type DialAction, type DidReceiveSettingsEvent, type KeyUpEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { openExternal } from "../core/commands.js";
import { failureLabel } from "../core/feedback.js";
import { gaugeStripArt, renderGaugeKey } from "../core/gauge.js";
import { htmlLang, t } from "../core/i18n.js";
import { renderInfoBar, renderLimitBar, renderNoticeBar } from "../core/infobar.js";
import { COLORS, glyphArt, renderInfoKey } from "../core/render.js";
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
	tightestWindow,
	windowChoices,
} from "../core/usage/limitsView.js";
import { LimitsRefresher } from "../core/usage/refresh.js";
import { deck } from "../deck.js";
import { DeckAction, driverMark, driverName, errorMessage, held, pressWhileDisconnected, readyMachines, sendChoices } from "./base.js";
import { connectionNotice } from "./infobar.js";
import { connectionOf } from "./needs.js";
import { type DialSettings, StripDial } from "./strip.js";
import { MachineWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";
const logger = streamDeck.logger.createScope("limits");

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

const refresher = new LimitsRefresher();

/**
 * Re-reads one machine's limits. Automatic refreshes keep to T3 Code's five-minute gap; a manual one shares a refresh
 * in flight, or with `after` runs again once it ends, as after spending a reset.
 */
function refresh(machine: Machine, automatic: boolean, after = false): Promise<void> {
	const environmentId = machine.environmentId;
	if (environmentId === undefined) return Promise.resolve();
	const done = refresher.refresh(environmentId, () => machine.refreshProviders(), automatic, after).then(() => undefined);
	deck.repaint();
	return done.finally(() => deck.repaint());
}

const automatic = (machine: Machine): void => void refresh(machine, true).catch((error: unknown) => logger.warn(`Refreshing limits failed: ${errorMessage(error)}`));

const refreshing = (url: string | undefined): boolean => readyMachines(url).some((machine) => refresher.pending(machine.environmentId!));

/**
 * The machines visible Limits instances read stay on the config subscription. Limits refresh when a machine is first
 * watched and whenever an instance shows them, when they go stale (T3 Code's widget rule, checked on the minute tick
 * that also redraws) and on a press, all through T3 Code's throttle.
 */
const watch = new MachineWatch({ open: (machine) => machine.watchConfig(), opened: automatic });
watch.onTick(() => {
	const now = Date.now();
	for (const machine of watch.machines()) if (pools(machine.url, now).some((pool) => limitsStale(pool, now))) automatic(machine);
});

/** An instance appeared or changed: every watched machine gets an automatic refresh. */
const refreshWatched = () => watch.machines().forEach(automatic);

/** A manual refresh of every machine an instance reads; resolves when all are back. */
const refreshAll = (url: string | undefined) => Promise.all(readyMachines(url).map((machine) => refresh(machine, false)));

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
		try {
			// T3 Code has no Usage link yet; this brings the app forward, and lands on Usage once it routes one.
			await openExternal(`${deck.scheme}://usage`);
			return { ok: true, label: t("result.opened") };
		} catch (error) {
			logger.warn(`Opening T3 Code failed: ${errorMessage(error)}`);
			return { ok: false, label: failureLabel(error) };
		}
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
		logger.warn(`Using a reset failed: ${errorMessage(error)}`);
		return { ok: false, label: failureLabel(error) };
	} finally {
		void refresh(plan.machine, false, true).catch(() => undefined);
	}
}

/**
 * The machines a "spend" instance may spend on: its own machine, or with All machines those that hold a credit to
 * spend now. Only these are ever asked for provider access.
 */
function spendMachines(url: string | undefined, settings: LimitsSettings): Machine[] {
	if (resetAction(settings.resetAction) !== "spend") return [];
	if (url !== undefined) return readyMachines(url);
	const targets = new Set(pools(url).flatMap((pool) => resetPlan(pool)?.machine.url ?? []));
	return readyMachines(undefined).filter((machine) => targets.has(machine.url));
}

/**
 * Flags provider access where a "spend" instance would spend, so those machines' next pairing asks for it. Only when
 * the user turns "spend" on (and on a hold that spends), so Don't ask in the machine card sticks.
 */
function optInFor(url: string | undefined, settings: LimitsSettings, before: string | undefined): void {
	if (resetAction(before) === "spend") return;
	for (const machine of spendMachines(url, settings)) if (!grants(machine.scopes, PROVIDERS_SCOPE)) void deck.optInScope(machine.url, PROVIDERS_SCOPE);
}

/** The checklist's provider access line for a "spend" instance: met when every machine it may spend on has it. */
function spendNeeds(url: string | undefined, settings: LimitsSettings): Need[] {
	const machines = spendMachines(url, settings);
	return machines.length === 0 ? [] : [{ kind: "scope", scope: PROVIDERS_SCOPE, ok: machines.every((machine) => grants(machine.scopes, PROVIDERS_SCOPE)) }];
}

/**
 * The gauge's two gray lines: when it resets (or that it needs a refresh), and the banked resets, or in amber that
 * spending them needs provider access the pool's machine lacks.
 */
function gaugeLines(gauge: LimitGauge, pool: LimitPool, url: string | undefined, settings: LimitsSettings, now: number): [string, string | { text: string; color: string }] {
	const first = refreshing(url) ? t("limits.refreshing") : gauge.stale ? t("limits.pressToRefresh") : gauge.resetAt === undefined ? "" : resetText(gauge.resetAt, now, htmlLang(streamDeck.i18n.language));
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
	protected override readonly watcher = watch;

	constructor() {
		super();
		watch.onTick(() => this.repaintAll());
	}

	protected override watched(action: Action<LimitsSettings>): readonly Machine[] {
		return readyMachines(this.machineOf(action));
	}

	#state(action: Action<LimitsSettings>) {
		const url = this.machineOf(action);
		const settings = this.settingsOf(action);
		const all = pools(url);
		const pool = settings.provider ? all.find((candidate) => candidate.driver === settings.provider) : all[0];
		return { url, settings, all, pool, window: pool && findWindow(pool, settings.window) };
	}

	protected override async draw(action: Action<LimitsSettings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		if (!action.isKey()) return;
		const { url, settings, all, pool, window } = this.#state(action);
		if (all.length === 0) return void (await this.setImage(action, renderInfoKey({ glyph: "gauge", title: t("limits.title"), detail: t("limits.none"), available: false })));
		if (pool === undefined || window === undefined) {
			const missing = pool === undefined ? driverName(settings.provider ?? "") : (settings.window ?? "");
			return void (await this.setImage(action, renderInfoKey({ glyph: "gauge", title: t("limits.title"), detail: t("needs.notAvailable", { value: missing }), available: false })));
		}
		const now = Date.now();
		const show = limitsShow(settings.show);
		const gauge = limitGauge(pool, window, now, show);
		await this.setImage(
			action,
			renderGaugeKey({
				mark: driverMark(pool.driver),
				label: gauge.label,
				value: `${gauge.percent}%`,
				lines: gaugeLines(gauge, pool, url, settings, now),
				fill: gauge.percent / 100,
				...(gauge.pace === undefined ? {} : { marker: gauge.pace / 100 }),
				dim: gauge.stale,
			}),
		);
	}

	/** On the Neo info bar: the set window, or with none set the one nearest its limit, with its reset. */
	async #paintBar(action: Action<LimitsSettings>): Promise<void> {
		const notice = connectionNotice(this.machineOf(action));
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const { url, settings, all, pool, window } = this.#state(action);
		const shown = settings.provider || settings.window ? pool && window && { pool, window } : tightestWindow(all);
		if (shown === undefined)
			return this.setBar(action, renderInfoBar({ icon: { glyph: "gauge", color: COLORS.muted }, title: t("limits.title"), detail: t(all.length === 0 ? "limits.none" : "reason.unavailable"), available: false }));
		const now = Date.now();
		const gauge = limitGauge(shown.pool, shown.window, now, limitsShow(settings.show));
		const [first] = gaugeLines(gauge, shown.pool, url, settings, now);
		await this.setBar(
			action,
			renderLimitBar({
				mark: driverMark(shown.pool.driver),
				label: `${driverName(shown.pool.driver)} · ${gauge.label}`,
				percent: gauge.percent,
				used: shown.window.usedPercent / 100,
				...(gauge.pace === undefined ? {} : { pace: gauge.pace / 100 }),
				detail: first,
				dim: gauge.stale,
			}),
		);
	}

	override onWillAppear(ev: WillAppearEvent<LimitsSettings>): void {
		super.onWillAppear(ev);
		refreshWatched();
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<LimitsSettings>): Promise<void> {
		const before = this.settingsOf(ev.action).resetAction;
		super.onDidReceiveSettings(ev);
		refreshWatched();
		optInFor(this.machineOf(ev.action), this.settingsOf(ev.action), before);
		if (streamDeck.ui.action?.id === ev.action.id) await this.#sendWindows(ev.action);
	}

	override async onKeyUp(ev: KeyUpEvent<LimitsSettings>): Promise<void> {
		const heldMs = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		const { url, settings, pool } = this.#state(ev.action);
		if (held(heldMs)) {
			const result = await useReset(pool, settings);
			return result.ok ? this.paint(ev.action) : this.flash(ev.action, false, result.label);
		}
		const refreshing = refreshAll(url);
		if (resetAction(settings.resetAction) === "spend" && pool !== undefined && resetTarget(pool) !== undefined) await this.flash(ev.action, false, t("limits.holdToReset"));
		await this.run(ev.action, () => refreshing);
	}

	/** The Provider and Window settings' choices: the providers reporting limits on the key's machines, and the chosen one's windows. */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, LimitsSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event === "getLimitProviders") return this.#sendProviders(ev.action);
		if (payload?.event === "getLimitWindows") return this.#sendWindows(ev.action);
		return super.onSendToPlugin(ev);
	}

	async #sendProviders(action: Action<LimitsSettings>): Promise<void> {
		const items = [{ label: t("datasource.firstProvider"), value: "" }, ...pools(this.machineOf(action)).map((pool) => ({ label: driverName(pool.driver), value: pool.driver }))];
		await sendChoices("getLimitProviders", items, this.settingsOf(action).provider, (saved) => t("needs.notAvailable", { value: driverName(saved) }));
	}

	async #sendWindows(action: Action<LimitsSettings>): Promise<void> {
		const { settings, pool } = this.#state(action);
		const choices = pool ? windowChoices(pool) : [];
		await sendChoices("getLimitWindows", [{ label: t("datasource.firstWindow"), value: "" }, ...choices], settings.window, (value) => t("needs.notAvailable", { value }));
	}

	override needs(action: Action<LimitsSettings>): Need[] {
		const { url, settings, all, pool, window } = this.#state(action);
		const ready = connectionOf(url) === "ready";
		return [
			{ kind: "paired", connection: connectionOf(url) },
			{ kind: "limits", ok: ready ? all.length > 0 : false },
			...(ready && settings.provider ? [{ kind: "value", value: driverName(settings.provider), ok: pool !== undefined } satisfies Need] : []),
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
	protected override readonly watcher = watch;

	constructor() {
		super();
		watch.onTick(() => this.repaintAll());
	}

	protected override watched(action: Action<LimitsDialSettings>): readonly Machine[] {
		return readyMachines(this.machineOf(action));
	}

	protected heading(): string {
		return t("limits.title");
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
		const { tiles, index } = this.#tiles(action);
		const tile = tiles[index];
		if (tile === undefined) return { header: t("limits.title"), icon: glyphArt("gauge", COLORS.muted), value: t("limits.none"), detail: t("limits.noneDetail") };
		const now = Date.now();
		const gauge = this.#gauge(action, tile, now);
		const [when, credits] = gaugeLines(gauge, tile.pool, this.machineOf(action), this.settingsOf(action), now).map(lineText);
		const reset = gauge.resetAt === undefined || gauge.resetAt <= now ? "" : t("limits.resetsIn", { time: resetText(gauge.resetAt, now, htmlLang(streamDeck.i18n.language)) });
		return {
			header: driverName(tile.pool.driver),
			icon: driverMark(tile.pool.driver),
			value: `${gauge.label} · ${gauge.percent}%`,
			detail: [gauge.stale ? when : reset || when, credits, gauge.accounts > 1 ? t("limits.pooled", { count: gauge.accounts }) : ""].filter(Boolean).join(" · "),
		};
	}

	protected override picture(action: Action<LimitsDialSettings>): string | undefined {
		const { tiles, index } = this.#tiles(action);
		const tile = tiles[index];
		if (tile === undefined) return undefined;
		const now = Date.now();
		const gauge = this.#gauge(action, tile, now);
		const [when, credits] = gaugeLines(gauge, tile.pool, this.machineOf(action), this.settingsOf(action), now);
		return gaugeStripArt({
			mark: driverMark(tile.pool.driver),
			label: gauge.label,
			value: `${gauge.percent}%`,
			lines: [when, credits],
			fill: gauge.percent / 100,
			...(gauge.pace === undefined ? {} : { marker: gauge.pace / 100 }),
			dim: gauge.stale,
			footer: gauge.accounts > 1 ? `${driverName(tile.pool.driver)} · ${t("limits.pooled", { count: gauge.accounts })}` : driverName(tile.pool.driver),
			position: tiles.length > 1 ? `${index + 1}/${tiles.length}` : "",
		});
	}

	protected override list(action: Action<LimitsDialSettings>): StripList | undefined {
		const { tiles, index } = this.#tiles(action);
		if (tiles.length === 0) return undefined;
		const now = Date.now();
		const shown = this.#gauge(action, tiles[index]!, now);
		const [when, credits] = gaugeLines(shown, tiles[index]!.pool, this.machineOf(action), this.settingsOf(action), now).map(lineText);
		return {
			heading: t("limits.title"),
			items: tiles.map((tile) => {
				const gauge = this.#gauge(action, tile, now);
				return { key: tile.key, label: `${driverName(tile.pool.driver)} · ${gauge.label} · ${gauge.percent}%`, art: driverMark(tile.pool.driver), caption: `${gauge.percent}%` };
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

	protected override async pressed(dial: DialAction<LimitsDialSettings>, heldMs: number): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		if (held(heldMs)) {
			const { tiles, index } = this.#tiles(dial);
			const result = await useReset(tiles[index]?.pool, this.settingsOf(dial));
			return result.ok ? this.paint(dial) : this.flash(dial, false, result.label);
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
		await this.run(dial, () => refreshing);
	}

	override onWillAppear(ev: WillAppearEvent<LimitsDialSettings>): void {
		super.onWillAppear(ev);
		refreshWatched();
	}

	override onWillDisappear(ev: WillDisappearEvent<LimitsDialSettings>): void {
		this.#selected.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<LimitsDialSettings>): void {
		const before = this.settingsOf(ev.action).resetAction;
		super.onDidReceiveSettings(ev);
		refreshWatched();
		optInFor(this.machineOf(ev.action), this.settingsOf(ev.action), before);
	}

	override needs(action: Action<LimitsDialSettings>): Need[] {
		const url = this.machineOf(action);
		const ready = connectionOf(url) === "ready";
		return [{ kind: "paired", connection: connectionOf(url) }, { kind: "limits", ok: ready ? pools(url).length > 0 : false }, ...spendNeeds(url, this.settingsOf(action))];
	}
}
