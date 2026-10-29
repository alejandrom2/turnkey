import streamDeck, { type Action, action, type DialAction, type DidReceiveSettingsEvent, type SendToPluginEvent, type WillAppearEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { failureLabel } from "../core/feedback.js";
import { gaugeStripArt } from "../core/gauge.js";
import { renderNoticeBar, renderUsageBar } from "../core/infobar.js";
import { t } from "../core/i18n.js";
import { itemMark, MISMATCH, readShown, refreshDue, refreshUsage, usageAccess, usageKey, usageMachines, usageReaders, type UsageSettings, type UsageState, usageView } from "../core/keys/usage.js";
import { COLORS, glyphArt } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { needsAccessLabel } from "../core/scopes.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { DIAGNOSTICS_SCOPE } from "../core/t3/pairing.js";
import { type UsagePeriod, usagePeriod } from "../core/usage/store.js";
import { USAGE_PROVIDER_KINDS, type UsageProviderKind } from "../core/usage/types.js";
import { periodLabel, usageDriver, usageItems, usageKindOf, usageProvider } from "../core/usage/usageView.js";
import type { MachineWatch } from "../core/watch.js";
import { driverName, LONG_PRESS_MS, pressWhileDisconnected, readyMachines, sendChoices } from "./base.js";
import { connectionNotice } from "./infobar.js";
import { connectionOf } from "./needs.js";
import { deckRuntime } from "./runtime.js";
import { SharedKey } from "./shared.js";
import { type DialSettings, StripDial } from "./strip.js";
import { DeckWatch } from "./watch.js";

const ID = "com.alejandrom2.turnkey";

/** The shown machines' settings stay live, so a price or alias change reads again, as in T3 Code. */
const watch = new DeckWatch({ open: (machine) => machine.watchConfig() });

/**
 * The Provider setting's choices: the usage providers set up on the instance's machines, then any with usage in the
 * period, in T3 Code's order; a saved one that is neither stays listed as not available.
 */
async function sendUsageProviders(url: string | undefined, period: UsagePeriod, saved: string | undefined): Promise<void> {
	const found = new Set<UsageProviderKind>();
	for (const machine of readyMachines(url)) {
		for (const provider of machine.modelConfig?.providers ?? []) {
			const kind = usageKindOf(provider.driver ?? provider.instanceId);
			if (kind !== undefined) found.add(kind);
		}
	}
	for (const totals of deckRuntime.usage.view(usageReaders(deckRuntime, url), period).merged?.providers ?? []) found.add(totals.provider);
	const kinds = USAGE_PROVIDER_KINDS.filter((kind) => found.has(kind));
	const name = (kind: string) => driverName(usageDriver(kind as UsageProviderKind));
	const items = [{ label: t("inspector.usage.allProviders"), value: "" }, ...kinds.map((kind) => ({ label: name(kind), value: kind }))];
	await sendChoices("getUsageProviders", items, saved, (value) => t("needs.notAvailable", { value: usageProvider(value) ? name(value) : value }));
}

const usageNeeds = (url: string | undefined): Need[] => [
	{ kind: "paired", connection: connectionOf(url) },
	{ kind: "scope", scope: DIAGNOSTICS_SCOPE, ok: connectionOf(url) === "ready" && usageAccess(deckRuntime, url) },
];

/** A period's API-estimate cost, tokens and sessions, on the key's machine or merged across every machine. */
@action({ UUID: `${ID}.usage` })
export class UsageKey extends SharedKey<UsageSettings, UsageState> {
	protected readonly definition = usageKey;

	constructor() {
		super();
		watch.onTick(() => this.actions.forEach((instance) => refreshDue(deckRuntime, this.machineOf(instance), usagePeriod(this.settingsOf(instance).period))));
	}

	/** One watch with the Usage dial: both keep the same machines' settings live. */
	protected override watching(): MachineWatch {
		return watch;
	}

	protected override watched(action: Action<UsageSettings>): readonly Machine[] {
		return usageMachines(deckRuntime, this.machineOf(action));
	}

	protected override async draw(action: Action<UsageSettings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		return super.draw(action);
	}

	/** On the Neo info bar: the period, its cost on the right, and tokens under the period. */
	async #paintBar(action: Action<UsageSettings>): Promise<void> {
		const url = this.machineOf(action);
		const notice = connectionNotice(url);
		if (notice) return this.setBar(action, renderNoticeBar(notice));
		const period = usagePeriod(this.settingsOf(action).period);
		const label = periodLabel(period);
		if (!usageAccess(deckRuntime, url)) return this.setBar(action, renderUsageBar({ label, detail: needsAccessLabel(DIAGNOSTICS_SCOPE), available: false }));
		const { merged, loading, error, mismatch } = usageView(deckRuntime, url, period);
		if (mismatch !== undefined) return this.setBar(action, renderUsageBar({ label, detail: t(MISMATCH[mismatch]), available: false }));
		if (merged === undefined) {
			const failed = !loading && error !== undefined;
			return this.setBar(action, renderUsageBar({ label, detail: failed ? failureLabel(error) : t("result.loading"), available: !failed }));
		}
		const [total] = usageItems(merged, usageProvider(this.settingsOf(action).provider));
		await this.setBar(action, renderUsageBar({ mark: total!.provider && itemMark(total!), label, value: total!.cost, detail: total!.tokens, dim: loading }));
	}

	override onWillAppear(ev: WillAppearEvent<UsageSettings>): void {
		super.onWillAppear(ev);
		readShown(deckRuntime, this.machineOf(ev.action), usagePeriod(this.settingsOf(ev.action).period));
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): void {
		super.onDidReceiveSettings(ev);
		const settings = this.settingsOf(ev.action);
		readShown(deckRuntime, this.machineOf(ev.action), usagePeriod(settings.period));
		// The open inspector's provider list follows its machine and period.
		if (streamDeck.ui.action?.id === ev.action.id) void sendUsageProviders(this.machineOf(ev.action), usagePeriod(settings.period), settings.provider);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, UsageSettings>): Promise<void> {
		if ((ev.payload as { event?: string } | null)?.event !== "getUsageProviders") return super.onSendToPlugin(ev);
		const settings = this.settingsOf(ev.action);
		await sendUsageProviders(this.machineOf(ev.action), usagePeriod(settings.period), settings.provider);
	}

	override needs(action: Action<UsageSettings>): Need[] {
		return usageNeeds(this.machineOf(action));
	}
}

type UsageDialSettings = DialSettings & { period?: string; provider?: string };

/**
 * Turns through a period's figures: the total, then each model by cost with its provider's mark, tokens, cache hit
 * rate and cost per million tokens. Press or tap reads again; a long press reloads model prices first.
 */
@action({ UUID: `${ID}.dial.usage` })
export class UsageDial extends StripDial<UsageDialSettings> {
	readonly #selected = new Map<string, string>();
	protected override readonly watcher = watch;

	constructor() {
		super();
		watch.onTick(() => this.actions.forEach((instance) => refreshDue(deckRuntime, this.machineOf(instance), usagePeriod(this.settingsOf(instance).period))));
	}

	protected override watched(action: Action<UsageDialSettings>): readonly Machine[] {
		return usageMachines(deckRuntime, this.machineOf(action));
	}

	#state(action: Action<UsageDialSettings>) {
		const url = this.machineOf(action);
		const period = usagePeriod(this.settingsOf(action).period);
		const view = usageView(deckRuntime, url, period);
		const items = view.merged === undefined ? [] : usageItems(view.merged, usageProvider(this.settingsOf(action).provider));
		const index = Math.max(0, items.findIndex((item) => item.key === this.#selected.get(action.id)));
		return { url, period, ...view, items, index, item: items[index] };
	}

	protected heading(): string {
		return t("usage.title");
	}

	protected face(action: Action<UsageDialSettings>): StripContent {
		const header = this.heading();
		const { url, period, item, loading, error, mismatch } = this.#state(action);
		const muted = (value: string, detail: string): StripContent => ({ header, icon: glyphArt("usage", COLORS.muted), value, detail });
		if (!usageAccess(deckRuntime, url)) return muted(periodLabel(period), needsAccessLabel(DIAGNOSTICS_SCOPE));
		if (mismatch !== undefined) return muted(periodLabel(period), t(MISMATCH[mismatch]));
		if (item === undefined) return { ...muted(periodLabel(period), error === undefined || loading ? "" : failureLabel(error)), loading: loading || error === undefined };
		return { header: `${header} · ${periodLabel(period)}`, icon: itemMark(item), value: `${item.label} · ${item.cost}`, detail: [item.tokens, item.detail].filter(Boolean).join(" · ") };
	}

	protected override picture(action: Action<UsageDialSettings>): string | undefined {
		const { url, period, items, index, item, loading } = this.#state(action);
		if (!usageAccess(deckRuntime, url) || item === undefined) return undefined;
		return gaugeStripArt({
			mark: itemMark(item),
			// The total names its period; each model's bar is its share of it.
			label: item.key === "total" ? periodLabel(period) : item.label,
			value: item.cost,
			lines: [item.tokens, item.detail],
			...(item.share === undefined ? {} : { fill: item.share }),
			dim: loading,
			position: items.length > 1 ? `${index + 1}/${items.length}` : "",
			stacked: true,
		});
	}

	protected override list(action: Action<UsageDialSettings>): StripList | undefined {
		const { period, items, index, item } = this.#state(action);
		if (item === undefined) return undefined;
		return {
			heading: `${t("usage.title")} · ${periodLabel(period)}`,
			items: items.map((entry) => ({ key: entry.key, label: `${entry.label} · ${entry.cost}`, art: itemMark(entry), caption: entry.cost, detail: [entry.tokens, entry.detail].filter(Boolean).join(" · ") })),
			index,
			note: { text: [item.tokens, item.detail].filter(Boolean).join(" · ") },
		};
	}

	protected override rotated(dial: DialAction<UsageDialSettings>, ticks: number): void {
		const { items, index } = this.#state(dial);
		if (items.length === 0) return;
		this.#selected.set(dial.id, items[(((index + ticks) % items.length) + items.length) % items.length]!.key);
	}

	protected override async pressed(dial: DialAction<UsageDialSettings>, held: number): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		await this.run(dial, () => refreshUsage(deckRuntime, this.machineOf(dial), usagePeriod(this.settingsOf(dial).period), held >= LONG_PRESS_MS));
	}

	protected override async tapped(dial: DialAction<UsageDialSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		await this.run(dial, () => refreshUsage(deckRuntime, this.machineOf(dial), usagePeriod(this.settingsOf(dial).period), false));
	}

	override onWillAppear(ev: WillAppearEvent<UsageDialSettings>): void {
		super.onWillAppear(ev);
		readShown(deckRuntime, this.machineOf(ev.action), usagePeriod(this.settingsOf(ev.action).period));
	}

	override onWillDisappear(ev: WillDisappearEvent<UsageDialSettings>): void {
		this.#selected.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageDialSettings>): void {
		super.onDidReceiveSettings(ev);
		const settings = this.settingsOf(ev.action);
		readShown(deckRuntime, this.machineOf(ev.action), usagePeriod(settings.period));
		// The open inspector's provider list follows its machine and period.
		if (streamDeck.ui.action?.id === ev.action.id) void sendUsageProviders(this.machineOf(ev.action), usagePeriod(settings.period), settings.provider);
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, UsageDialSettings>): Promise<void> {
		if ((ev.payload as { event?: string } | null)?.event !== "getUsageProviders") return super.onSendToPlugin(ev);
		const settings = this.settingsOf(ev.action);
		await sendUsageProviders(this.machineOf(ev.action), usagePeriod(settings.period), settings.provider);
	}

	override needs(action: Action<UsageDialSettings>): Need[] {
		return usageNeeds(this.machineOf(action));
	}
}
