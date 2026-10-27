/**
 * What a Usage key or dial shows for a period, in T3 Code's figures: the period's cost, tokens and sessions, then each
 * model's cost, tokens, cache hit rate and cost per million tokens (apps/web/src/components/usage/UsagePage.tsx).
 */
import { type MessageKey, t } from "../i18n.js";
import { formatCount, formatPercent, formatTokens, formatUsd } from "./format.js";
import { cacheHitRate, costPerMillionTokens, isModelCostUnknown, type MergedUsage } from "./merge.js";
import type { UsagePeriod } from "./store.js";
import type { UsageProviderKind } from "./types.js";

const PERIOD_LABEL: Record<UsagePeriod, MessageKey> = { 1: "usage.period.day", 7: "usage.period.week", 30: "usage.period.month", 90: "usage.period.quarter" };

/** T3 Code's period names: "Past 24h", "7 days", "30 days", "90 days". */
export const periodLabel = (period: UsagePeriod): string => t(PERIOD_LABEL[period]);

/** Usage names Claude Code `claude`; its provider mark and limits know it as `claudeAgent`. */
export const usageDriver = (provider: UsageProviderKind): string => (provider === "claude" ? "claudeAgent" : provider);

export type UsageItem = {
	key: string;
	/** The model, or "All models" for the period's total. */
	label: string;
	/** Undefined for the total. */
	provider?: UsageProviderKind;
	cost: string;
	/** Of the period's cost, for a model whose cost is known. */
	share?: number;
	tokens: string;
	/** "95.1% cache · $0.93/M", or the sessions for the total. */
	detail: string;
};

/** The period's total, then each model by cost, as T3 Code's breakdown lists them. */
export function usageItems(merged: MergedUsage): UsageItem[] {
	const total: UsageItem = {
		key: "total",
		label: t("usage.allModels"),
		cost: formatUsd(merged.costUsd),
		tokens: t("usage.tokens", { tokens: formatTokens(merged.totalTokens) }),
		detail: t("usage.sessions", { count: formatCount(merged.sessions) }),
	};
	return [
		total,
		...merged.models.map((model): UsageItem => {
			const unknown = isModelCostUnknown(model);
			const hit = cacheHitRate(model);
			const perMillion = costPerMillionTokens(model);
			return {
				key: `${model.provider}|${model.model}`,
				label: model.model,
				provider: model.provider,
				cost: unknown ? t("usage.unpriced") : formatUsd(model.costUsd),
				...(unknown ? {} : { share: model.costShare }),
				tokens: t("usage.tokens", { tokens: formatTokens(model.totalTokens) }),
				detail: [hit === null ? undefined : t("usage.cacheHit", { percent: formatPercent(hit) }), perMillion === null ? undefined : t("usage.perMillion", { cost: formatUsd(perMillion) })]
					.filter(Boolean)
					.join(" · "),
			};
		}),
	];
}
