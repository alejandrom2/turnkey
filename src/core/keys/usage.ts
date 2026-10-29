import { errorMessage, failureLabel } from "../feedback.js";
import { renderGaugeKey } from "../gauge.js";
import { type MessageKey, t } from "../i18n.js";
import { driverMark } from "../models.js";
import { COLORS, glyphArt, type MarkPainter, renderInfoKey, renderSkeletonKey } from "../render.js";
import { ringFace } from "../ring.js";
import { grants, needsAccessLabel } from "../scopes.js";
import type { Machine } from "../t3/machine.js";
import { DIAGNOSTICS_SCOPE } from "../t3/pairing.js";
import { type UsagePeriod, type UsageReader, usagePeriod } from "../usage/store.js";
import { periodLabel, type UsageItem, usageDriver, usageItems, usageProvider } from "../usage/usageView.js";
import { type KeyDefinition, type KeyRuntime, LONG_PRESS_MS } from "./key.js";

export type UsageSettings = { machine?: string; period?: string; provider?: string };

/** The ready machines an instance following `url` (or every machine) reads usage from: those whose pairing may. */
export const usageMachines = (runtime: Pick<KeyRuntime, "machines">, url: string | undefined): Machine[] =>
	runtime
		.machines()
		.filter((machine) => (url === undefined || machine.url === url) && machine.state.kind === "ready" && machine.environmentId !== undefined && grants(machine.scopes, DIAGNOSTICS_SCOPE));

/** A ready machine as the store reads it. */
const reader = (machine: Machine): UsageReader => ({
	url: machine.url,
	environmentId: machine.environmentId!,
	usageSettingsStamp: machine.usageSettingsStamp,
	usageSummary: (input) => machine.usageSummary(input),
});

export const usageReaders = (runtime: Pick<KeyRuntime, "machines">, url: string | undefined): UsageReader[] => usageMachines(runtime, url).map(reader);

/** A shown period's usage, read on a machine that hasn't yet (one newly ready) or whose settings moved. */
export function usageView(runtime: Pick<KeyRuntime, "machines" | "usage">, url: string | undefined, period: UsagePeriod) {
	const machines = usageReaders(runtime, url);
	for (const machine of machines) runtime.usage.ensure(machine, period, Number.POSITIVE_INFINITY);
	return runtime.usage.view(machines, period);
}

/** Reads a period as an instance shows it, unless it was read in the last minute. */
export function readShown(runtime: Pick<KeyRuntime, "machines" | "usage">, url: string | undefined, period: UsagePeriod): void {
	for (const machine of usageReaders(runtime, url)) runtime.usage.ensure(machine, period);
}

/** Reads a shown period again once due (every five minutes), checked on the watch's minute tick. */
export function refreshDue(runtime: Pick<KeyRuntime, "machines" | "usage">, url: string | undefined, period: UsagePeriod): void {
	for (const machine of usageReaders(runtime, url)) if (runtime.usage.due(machine, period)) void runtime.usage.refresh(machine, period);
}

/** A press reads the period again; a long one reloads T3 Code's model prices first, as its refresh button does. */
export async function refreshUsage(runtime: Pick<KeyRuntime, "machines" | "usage" | "warn">, url: string | undefined, period: UsagePeriod, prices: boolean): Promise<void> {
	const machines = usageReaders(runtime, url);
	if (machines.length === 0) throw Object.assign(new Error("Missing diagnostics access"), { requiredPermission: DIAGNOSTICS_SCOPE });
	await Promise.all(
		machines.map(async (machine) => {
			if (prices) {
				await runtime
					.machines()
					.find((candidate) => candidate.url === machine.url)
					?.refreshUsageRates()
					.catch((error: unknown) => runtime.warn(`Refreshing prices failed: ${errorMessage(error)}`));
			}
			await runtime.usage.refresh(machine, period, prices);
		}),
	);
	const failed = machines.map((machine) => runtime.usage.entry(machine, period)?.error).find((error) => error !== undefined);
	if (failed !== undefined && runtime.usage.view(machines, period).merged === undefined) throw failed;
}

/** Whether the instance's machines may read usage at all; T3 Code needs diagnostics access for it. */
export const usageAccess = (runtime: Pick<KeyRuntime, "machines">, url: string | undefined): boolean => usageMachines(runtime, url).length > 0;

export const itemMark = (item: UsageItem): MarkPainter => (item.provider === undefined ? glyphArt("usage") : driverMark(usageDriver(item.provider)));

/** Who has to update when a machine's usage contract is one the deck can't merge. */
export const MISMATCH: Record<"serverBehind" | "clientBehind", MessageKey> = { serverBehind: "usage.updateT3", clientBehind: "usage.updateDeck" };

export type UsageState = {
	url: string | undefined;
	period: UsagePeriod;
	label: string;
	/** Why it can't show a cost; undefined while loading or once it has one. */
	reason?: string;
	loading: boolean;
	total?: UsageItem;
};

/** A period's API-estimate cost, tokens and sessions, on the key's machine or merged across every machine. */
export const usageKey: KeyDefinition<UsageSettings, UsageState> = {
	state(ctx) {
		const url = ctx.machine;
		const period = usagePeriod(ctx.settings.period);
		const label = periodLabel(period);
		if (!usageAccess(ctx.runtime, url)) return { url, period, label, reason: needsAccessLabel(DIAGNOSTICS_SCOPE), loading: false };
		const { merged, loading, error, mismatch } = usageView(ctx.runtime, url, period);
		if (mismatch !== undefined) return { url, period, label, reason: t(MISMATCH[mismatch]), loading: false };
		if (merged === undefined) return { url, period, label, reason: loading || error === undefined ? undefined : failureLabel(error), loading: loading || error === undefined };
		const [total] = usageItems(merged, usageProvider(ctx.settings.provider));
		return { url, period, label, loading, total };
	},

	tile({ label, reason, loading, total }) {
		if (total !== undefined) return renderGaugeKey({ mark: total.provider && itemMark(total), label, value: total.cost, lines: [total.tokens, total.detail], dim: loading });
		if (reason === undefined) return renderSkeletonKey();
		return renderInfoKey({ glyph: "usage", title: label, detail: reason, available: false });
	},

	glyph: ({ total }) => ringFace(COLORS.accent, "usage", { dim: total === undefined }),
	label: ({ label, reason, total }) => (total !== undefined ? `${label} · ${total.cost}` : reason),
	available: ({ total }) => total !== undefined,

	press({ url, period }, ctx, input) {
		return { kind: "run", work: () => refreshUsage(ctx.runtime, url, period, input.heldMs >= LONG_PRESS_MS) };
	},
};
