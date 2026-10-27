import streamDeck, {
	type Action,
	action,
	type DialAction,
	type DidReceiveSettingsEvent,
	type KeyDownEvent,
	type KeyUpEvent,
	type SendToPluginEvent,
	type WillAppearEvent,
	type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { failureLabel } from "../core/feedback.js";
import { gaugeStripArt, renderGaugeKey } from "../core/gauge.js";
import { renderNoticeBar, renderUsageBar } from "../core/infobar.js";
import { type MessageKey, t } from "../core/i18n.js";
import { providerDisplayName, providerMark } from "../core/models.js";
import { COLORS, glyphArt, type MarkPainter, renderInfoKey, renderSkeletonKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants, needsAccessLabel } from "../core/scopes.js";
import type { StripContent } from "../core/strip.js";
import type { StripList } from "../core/styles.js";
import type { Machine } from "../core/t3/machine.js";
import { DIAGNOSTICS_SCOPE } from "../core/t3/pairing.js";
import { type UsagePeriod, type UsageReader, UsageStore, usagePeriod } from "../core/usage/store.js";
import { USAGE_PROVIDER_KINDS, type UsageProviderKind } from "../core/usage/types.js";
import { periodLabel, type UsageItem, usageDriver, usageItems, usageKindOf, usageProvider } from "../core/usage/usageView.js";
import { deck } from "../deck.js";
import { connectionFace, DeckAction, LONG_PRESS_MS, pressWhileDisconnected } from "./base.js";
import { connectionNotice, InfobarWriter } from "./infobar.js";
import { connectionOf } from "./needs.js";
import { type DialSettings, disconnectedStrip, StripDial } from "./strip.js";

const ID = "com.alejandrom2.turnkey";
const logger = streamDeck.logger.createScope("usage");

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A ready machine as the store reads it. */
const reader = (machine: Machine): UsageReader => ({
	url: machine.url,
	environmentId: machine.environmentId!,
	label: machine.state.kind === "ready" ? machine.state.label : machine.url,
	usageSettingsStamp: machine.usageSettingsStamp,
	usageSummary: (input) => machine.usageSummary(input),
});

/** The ready machines an instance following `url` (or every machine) reads usage from: those whose pairing may. */
const readers = (url: string | undefined): UsageReader[] =>
	deck.machines
		.filter((machine) => machine.state.kind === "ready" && machine.environmentId !== undefined && (url === undefined || machine.url === url) && grants(machine.scopes, DIAGNOSTICS_SCOPE))
		.map(reader);

const store = new UsageStore(
	() => deck.repaint(),
	Date.now,
	(machine, summary) => {
		if ((summary.scanDurationMs ?? 0) > 2_000) logger.info(`Usage scan on ${new URL(machine.url).host} took ${summary.scanDurationMs} ms`);
	},
);

/**
 * Which periods visible Usage instances show, on which machines: read when one appears (unless read in the last
 * minute) and every five minutes while any shows, checked once a minute. Nothing reads while none shows.
 */
class UsageWatch {
	readonly #shown = new Map<string, { url: string | undefined; period: UsagePeriod }>();
	readonly #configs = new Map<string, () => void>();
	#tick: ReturnType<typeof setInterval> | undefined;

	show(id: string, url: string | undefined, period: UsagePeriod): void {
		this.#shown.set(id, { url, period });
		for (const machine of readers(url)) store.ensure(machine, period);
		this.sync();
	}

	hide(id: string): void {
		this.#shown.delete(id);
		this.sync();
	}

	/**
	 * Keeps the shown machines' settings live (a price or alias change reads again, as in T3 Code) and reads what a
	 * newly ready machine hasn't yet.
	 */
	sync(): void {
		const shown = [...this.#shown.values()];
		const wanted = new Set<string>();
		for (const { url, period } of shown) {
			for (const machine of readers(url)) {
				wanted.add(machine.url);
				store.ensure(machine, period, Number.POSITIVE_INFINITY);
			}
		}
		for (const [url, release] of this.#configs) {
			if (wanted.has(url)) continue;
			release();
			this.#configs.delete(url);
		}
		for (const url of wanted) if (!this.#configs.has(url)) this.#configs.set(url, deck.machines.find((machine) => machine.url === url)!.watchConfig());
		if (shown.length === 0) {
			clearInterval(this.#tick);
			this.#tick = undefined;
		} else this.#tick ??= setInterval(() => this.#onTick(), 60_000);
	}

	#onTick(): void {
		for (const { url, period } of this.#shown.values()) for (const machine of readers(url)) if (store.due(machine, period)) void store.refresh(machine, period);
	}
}

const watch = new UsageWatch();
const infobar = new InfobarWriter();
deck.onRepaint(() => watch.sync());

/** A press reads the period again; a long one reloads T3 Code's model prices first, as its refresh button does. */
async function refreshUsage(url: string | undefined, period: UsagePeriod, prices: boolean): Promise<void> {
	const machines = readers(url);
	if (machines.length === 0) throw Object.assign(new Error("Missing diagnostics access"), { requiredPermission: DIAGNOSTICS_SCOPE });
	await Promise.all(
		machines.map(async (machine) => {
			if (prices) {
				await deck.machines
					.find((candidate) => candidate.url === machine.url)
					?.refreshUsageRates()
					.catch((error: unknown) => logger.warn(`Refreshing prices failed: ${message(error)}`));
			}
			await store.refresh(machine, period, prices);
		}),
	);
	const failed = machines.map((machine) => store.entry(machine, period)?.error).find((error) => error !== undefined);
	if (failed !== undefined && store.view(machines, period).merged === undefined) throw failed;
}

/**
 * The Provider setting's choices: the usage providers set up on the instance's machines, then any with usage in the
 * period, in T3 Code's order; a saved one that is neither stays listed as not available.
 */
async function sendUsageProviders(url: string | undefined, period: UsagePeriod, saved: string | undefined): Promise<void> {
	const found = new Set<UsageProviderKind>();
	for (const machine of deck.machines) {
		if (machine.state.kind !== "ready" || (url !== undefined && machine.url !== url)) continue;
		for (const provider of machine.modelConfig?.providers ?? []) {
			const kind = usageKindOf(provider.driver ?? provider.instanceId);
			if (kind !== undefined) found.add(kind);
		}
	}
	for (const totals of store.view(readers(url), period).merged?.providers ?? []) found.add(totals.provider);
	const kinds = USAGE_PROVIDER_KINDS.filter((kind) => found.has(kind));
	const name = (kind: string) => providerDisplayName({ instanceId: usageDriver(kind as UsageProviderKind), driver: usageDriver(kind as UsageProviderKind) });
	const items = [{ label: t("inspector.usage.allProviders"), value: "" }, ...kinds.map((kind) => ({ label: name(kind), value: kind }))];
	if (saved && !kinds.some((kind) => kind === saved)) items.push({ label: t("needs.notAvailable", { value: usageProvider(saved) ? name(saved) : saved }), value: saved });
	await streamDeck.ui.sendToPropertyInspector({ event: "getUsageProviders", items });
}

/** Whether the instance's machines may read usage at all; T3 Code needs diagnostics access for it. */
const usageAccess = (url: string | undefined): boolean =>
	deck.machines.some((machine) => machine.state.kind === "ready" && (url === undefined || machine.url === url) && grants(machine.scopes, DIAGNOSTICS_SCOPE));

const usageNeeds = (url: string | undefined): Need[] => [
	{ kind: "paired", connection: connectionOf(url) },
	{ kind: "scope", scope: DIAGNOSTICS_SCOPE, ok: connectionOf(url) === "ready" && usageAccess(url) },
];

const itemMark = (item: UsageItem): MarkPainter => {
	if (item.provider === undefined) return glyphArt("usage");
	const driver = usageDriver(item.provider);
	return (x, y, size) => providerMark({ driver, providerName: providerDisplayName({ instanceId: driver, driver }), accentColor: undefined, iconUrl: undefined, badge: false }, x, y, size);
};

/** Who has to update when a machine's usage contract is one the deck can't merge. */
const MISMATCH: Record<"serverBehind" | "clientBehind", MessageKey> = { serverBehind: "usage.updateT3", clientBehind: "usage.updateDeck" };

type UsageSettings = { machine?: string; period?: string; provider?: string };

/** A period's API-estimate cost, tokens and sessions, on the key's machine or merged across every machine. */
@action({ UUID: `${ID}.usage` })
export class UsageKey extends DeckAction<UsageSettings> {
	protected override async paint(action: Action<UsageSettings>): Promise<void> {
		if (action.isNeoInfobar()) return this.#paintBar(action);
		if (!action.isKey()) return;
		const url = this.machineOf(action);
		const offline = connectionFace(url);
		if (offline) return void (await this.setImage(action, offline));
		const period = usagePeriod(this.settingsOf(action).period);
		const label = periodLabel(period);
		if (!usageAccess(url)) return void (await this.setImage(action, renderInfoKey({ glyph: "usage", title: label, detail: needsAccessLabel(DIAGNOSTICS_SCOPE), available: false })));
		const { merged, loading, error, mismatch } = store.view(readers(url), period);
		if (mismatch !== undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "usage", title: label, detail: t(MISMATCH[mismatch]), available: false })));
		if (merged === undefined) {
			if (loading || error === undefined) return void (await this.setImage(action, renderSkeletonKey()));
			return void (await this.setImage(action, renderInfoKey({ glyph: "usage", title: label, detail: failureLabel(error), available: false })));
		}
		const [total] = usageItems(merged, usageProvider(this.settingsOf(action).provider));
		await this.setImage(action, renderGaugeKey({ mark: total!.provider && itemMark(total!), label, value: total!.cost, lines: [total!.tokens, total!.detail], dim: loading }));
	}

	/** On the Neo info bar: the period, its cost on the right, and tokens under the period. */
	async #paintBar(action: Action<UsageSettings>): Promise<void> {
		const url = this.machineOf(action);
		const notice = connectionNotice(url);
		if (notice) return infobar.paint(action, renderNoticeBar(notice));
		const period = usagePeriod(this.settingsOf(action).period);
		const label = periodLabel(period);
		if (!usageAccess(url)) return infobar.paint(action, renderUsageBar({ label, detail: needsAccessLabel(DIAGNOSTICS_SCOPE), available: false }));
		const { merged, loading, error, mismatch } = store.view(readers(url), period);
		if (mismatch !== undefined) return infobar.paint(action, renderUsageBar({ label, detail: t(MISMATCH[mismatch]), available: false }));
		if (merged === undefined) {
			const failed = !loading && error !== undefined;
			return infobar.paint(action, renderUsageBar({ label, detail: failed ? failureLabel(error) : t("result.loading"), available: !failed }));
		}
		const [total] = usageItems(merged, usageProvider(this.settingsOf(action).provider));
		await infobar.paint(action, renderUsageBar({ mark: total!.provider && itemMark(total!), label, value: total!.cost, detail: total!.tokens, dim: loading }));
	}

	override onWillAppear(ev: WillAppearEvent<UsageSettings>): void {
		infobar.forget(ev.action.id);
		super.onWillAppear(ev);
		watch.show(ev.action.id, this.machineOf(ev.action), usagePeriod(this.settingsOf(ev.action).period));
	}

	override onWillDisappear(ev: WillDisappearEvent<UsageSettings>): void {
		watch.hide(ev.action.id);
		infobar.forget(ev.action.id);
		super.onWillDisappear(ev);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageSettings>): void {
		super.onDidReceiveSettings(ev);
		const settings = this.settingsOf(ev.action);
		watch.show(ev.action.id, this.machineOf(ev.action), usagePeriod(settings.period));
		// The open inspector's provider list follows its machine and period.
		if (streamDeck.ui.action?.id === ev.action.id) void sendUsageProviders(this.machineOf(ev.action), usagePeriod(settings.period), settings.provider);
	}

	override onKeyDown(ev: KeyDownEvent<UsageSettings>): void {
		this.pressStarted(ev.action.id);
	}

	override async onKeyUp(ev: KeyUpEvent<UsageSettings>): Promise<void> {
		const long = this.wasLongPress(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		await this.run(ev.action, () => refreshUsage(this.machineOf(ev.action), usagePeriod(this.settingsOf(ev.action).period), long));
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

	#state(action: Action<UsageDialSettings>) {
		const url = this.machineOf(action);
		const period = usagePeriod(this.settingsOf(action).period);
		const view = store.view(readers(url), period);
		const items = view.merged === undefined ? [] : usageItems(view.merged, usageProvider(this.settingsOf(action).provider));
		const index = Math.max(0, items.findIndex((item) => item.key === this.#selected.get(action.id)));
		return { url, period, ...view, items, index, item: items[index] };
	}

	protected face(action: Action<UsageDialSettings>): StripContent {
		const header = t("usage.title");
		const offline = disconnectedStrip(header, this.machineOf(action));
		if (offline) return offline;
		const { url, period, item, loading, error, mismatch } = this.#state(action);
		const muted = (value: string, detail: string): StripContent => ({ header, icon: glyphArt("usage", COLORS.muted), accent: COLORS.muted, value, detail });
		if (!usageAccess(url)) return muted(periodLabel(period), needsAccessLabel(DIAGNOSTICS_SCOPE));
		if (mismatch !== undefined) return muted(periodLabel(period), t(MISMATCH[mismatch]));
		if (item === undefined) return { ...muted(periodLabel(period), error === undefined || loading ? "" : failureLabel(error)), loading: loading || error === undefined };
		return { header: `${header} · ${periodLabel(period)}`, icon: itemMark(item), accent: COLORS.accent, value: `${item.label} · ${item.cost}`, detail: [item.tokens, item.detail].filter(Boolean).join(" · ") };
	}

	protected override picture(action: Action<UsageDialSettings>): string | undefined {
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
		const { url, period, items, index, item, loading } = this.#state(action);
		if (!usageAccess(url) || item === undefined) return undefined;
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
		if (disconnectedStrip("", this.machineOf(action))) return undefined;
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
		await this.run(dial, () => refreshUsage(this.machineOf(dial), usagePeriod(this.settingsOf(dial).period), held >= LONG_PRESS_MS));
	}

	protected override async tapped(dial: DialAction<UsageDialSettings>): Promise<void> {
		if (await pressWhileDisconnected(this.machineOf(dial))) return;
		await this.run(dial, () => refreshUsage(this.machineOf(dial), usagePeriod(this.settingsOf(dial).period), false));
	}

	override onWillAppear(ev: WillAppearEvent<UsageDialSettings>): void {
		super.onWillAppear(ev);
		watch.show(ev.action.id, this.machineOf(ev.action), usagePeriod(this.settingsOf(ev.action).period));
	}

	override onWillDisappear(ev: WillDisappearEvent<UsageDialSettings>): void {
		watch.hide(ev.action.id);
		this.#selected.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	override onDidReceiveSettings(ev: DidReceiveSettingsEvent<UsageDialSettings>): void {
		super.onDidReceiveSettings(ev);
		const settings = this.settingsOf(ev.action);
		watch.show(ev.action.id, this.machineOf(ev.action), usagePeriod(settings.period));
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
