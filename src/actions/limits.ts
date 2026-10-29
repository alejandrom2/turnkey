import streamDeck, { type Action, action, type DialAction, type DidReceiveSettingsEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonObject, JsonValue } from "@elgato/utils";

import { gaugeStripArt } from "../core/gauge.js";
import { htmlLang, t } from "../core/i18n.js";
import { renderInfoBar, renderLimitBar, renderNoticeBar } from "../core/infobar.js";
import { gaugeLines, limitsKey, type LimitsSettings, type LimitsState, poolsOn, refreshAll, refreshMachine, resetPlan, useReset } from "../core/keys/limits.js";
import { COLORS, glyphArt } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants } from "../core/scopes.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { PROVIDERS_SCOPE } from "../core/t3/pairing.js";
import { type LimitPool, limitsStale } from "../core/usage/limits.js";
import { limitGauge, limitTiles, type LimitTile, limitsShow, resetAction, resetTarget, resetText, tightestWindow, windowChoices } from "../core/usage/limitsView.js";
import type { MachineWatch } from "../core/watch.js";
import { deck } from "../deck.js";
import { driverMark, driverName, errorMessage, held, pressWhileDisconnected, readyMachines, sendChoices } from "./base.js";
import { connectionNotice } from "./infobar.js";
import { connectionOf } from "./needs.js";
import { deckRuntime } from "./runtime.js";
import { SharedKey } from "./shared.js";
import { type DialSettings, StripDial } from "./strip.js";
import { DeckWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";
const logger = streamDeck.logger.createScope("limits");

const pools = (url: string | undefined, now = Date.now()): readonly LimitPool[] => poolsOn(deckRuntime, url, now);

const automatic = (machine: Machine): void => void refreshMachine(deckRuntime, machine, true).catch((error: unknown) => logger.warn(`Refreshing limits failed: ${errorMessage(error)}`));

/**
 * The machines visible Limits instances read stay on the config subscription. Limits refresh when a machine is first
 * watched and whenever an instance shows them, when they go stale (T3 Code's widget rule, checked on the minute tick
 * that also redraws) and on a press, all through T3 Code's throttle.
 */
const watch = new DeckWatch({ open: (machine) => machine.watchConfig(), opened: automatic });
watch.onTick(() => {
	const now = Date.now();
	for (const machine of watch.machines()) if (pools(machine.url, now).some((pool) => limitsStale(pool, now))) automatic(machine);
});

/** An instance appeared or changed: every watched machine gets an automatic refresh. */
const refreshWatched = () => watch.machines().forEach(automatic);

/**
 * The machines a "spend" instance may spend on: its own machine, or with All machines those that hold a credit to
 * spend now. Only these are ever asked for provider access.
 */
function spendMachines(url: string | undefined, settings: LimitsSettings): Machine[] {
	if (resetAction(settings.resetAction) !== "spend") return [];
	if (url !== undefined) return readyMachines(url);
	const targets = new Set(pools(url).flatMap((pool) => resetPlan(deckRuntime, pool)?.machine.url ?? []));
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

const lineText = (line: string | { text: string }) => (typeof line === "string" ? line : line.text);

/**
 * One provider's limit window, pooled across its accounts on the key's machine or every machine: % left (or used)
 * with a bar, the next reset and the resets banked. A tap refreshes; a hold opens T3 Code's Usage page or, when set,
 * spends a banked reset.
 */
@action({ UUID: `${ID}.limits` })
export class LimitsKey extends SharedKey<LimitsSettings & JsonObject, LimitsState> {
	protected readonly definition = limitsKey;

	/** One watch with the Limits dial: both keep the same machines' limits live. */
	protected override watching(): MachineWatch {
		return watch;
	}

	constructor() {
		super();
		watch.onTick(() => this.repaintAll());
	}

	protected override watched(action: Action<LimitsSettings & JsonObject>): readonly Machine[] {
		return readyMachines(this.machineOf(action));
	}

	#state(action: Action<LimitsSettings & JsonObject>) {
		return { ...this.stateOf(action), settings: this.settingsOf(action) };
	}

	protected override async draw(action: Action<LimitsSettings & JsonObject>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		return super.draw(action);
	}

	/** On the Neo info bar: the set window, or with none set the one nearest its limit, with its reset. */
	async #paintBar(action: Action<LimitsSettings & JsonObject>): Promise<void> {
		const notice = connectionNotice(this.machineOf(action));
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const { url, settings, all, pool, window } = this.#state(action);
		const shown = settings.provider || settings.window ? pool && window && { pool, window } : tightestWindow(all);
		if (shown === undefined)
			return this.setBar(action, renderInfoBar({ icon: { glyph: "gauge", color: COLORS.muted }, title: t("limits.title"), detail: t(all.length === 0 ? "limits.none" : "reason.unavailable"), available: false }));
		const now = Date.now();
		const gauge = limitGauge(shown.pool, shown.window, now, limitsShow(settings.show));
		const [first] = gaugeLines(deckRuntime, gauge, shown.pool, url, settings, now);
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

	override onWillAppear(ev: WillAppearEvent<LimitsSettings & JsonObject>): void {
		super.onWillAppear(ev);
		refreshWatched();
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<LimitsSettings & JsonObject>): Promise<void> {
		const before = this.settingsOf(ev.action).resetAction;
		super.onDidReceiveSettings(ev);
		refreshWatched();
		optInFor(this.machineOf(ev.action), this.settingsOf(ev.action), before);
		if (streamDeck.ui.action?.id === ev.action.id) await this.#sendWindows(ev.action);
	}

	/** The Provider and Window settings' choices: the providers reporting limits on the key's machines, and the chosen one's windows. */
	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, LimitsSettings & JsonObject>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event === "getLimitProviders") return this.#sendProviders(ev.action);
		if (payload?.event === "getLimitWindows") return this.#sendWindows(ev.action);
		return super.onSendToPlugin(ev);
	}

	async #sendProviders(action: Action<LimitsSettings & JsonObject>): Promise<void> {
		const items = [{ label: t("datasource.firstProvider"), value: "" }, ...pools(this.machineOf(action)).map((pool) => ({ label: driverName(pool.driver), value: pool.driver }))];
		await sendChoices("getLimitProviders", items, this.settingsOf(action).provider, (saved) => t("needs.notAvailable", { value: driverName(saved) }));
	}

	async #sendWindows(action: Action<LimitsSettings & JsonObject>): Promise<void> {
		const { settings, pool } = this.#state(action);
		const choices = pool ? windowChoices(pool) : [];
		await sendChoices("getLimitWindows", [{ label: t("datasource.firstWindow"), value: "" }, ...choices], settings.window, (value) => t("needs.notAvailable", { value }));
	}

	override needs(action: Action<LimitsSettings & JsonObject>): Need[] {
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
		const [when, credits] = gaugeLines(deckRuntime, gauge, tile.pool, this.machineOf(action), this.settingsOf(action), now).map(lineText);
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
		const [when, credits] = gaugeLines(deckRuntime, gauge, tile.pool, this.machineOf(action), this.settingsOf(action), now);
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
		const [when, credits] = gaugeLines(deckRuntime, shown, tiles[index]!.pool, this.machineOf(action), this.settingsOf(action), now).map(lineText);
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
			const result = await useReset(deckRuntime, tiles[index]?.pool, this.settingsOf(dial));
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
		const refreshing = refreshAll(deckRuntime, this.machineOf(dial));
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
