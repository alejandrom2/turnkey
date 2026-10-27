/**
 * Ported from T3 Code's packages/shared/src/usageFormat.ts: number formats and the summary window, so the deck's
 * figures and periods read exactly like T3 Code's Usage page. Hourly chart labels and the contract-mismatch
 * sentence are left out; nothing here draws them.
 */
import type { UsageResolution, UsageSummaryInput } from "./types.js";

const CURRENCY = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

const INTEGER = new Intl.NumberFormat("en-US");

export function formatUsd(value: number): string {
	return CURRENCY.format(value);
}

export function formatCount(value: number): string {
	return INTEGER.format(Math.round(value));
}

export function formatTokens(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1e12) return `${trim(value / 1e12)}T`;
	if (abs >= 1e9) return `${trim(value / 1e9)}B`;
	if (abs >= 1e6) return `${trim(value / 1e6)}M`;
	if (abs >= 1e3) return `${trim(value / 1e3)}K`;
	return INTEGER.format(Math.round(value));
}

function trim(value: number): string {
	const abs = Math.abs(value);
	const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2;
	return value.toFixed(digits).replace(/\.0+$/, "");
}

export function formatPercent(share: number, digits = 1): string {
	const percent = share * 100;
	const smallest = 10 ** -digits;
	if (percent > 0 && percent < smallest) return `<${smallest.toFixed(digits)}%`;
	return `${percent.toFixed(digits)}%`;
}

const HOUR_MS = 60 * 60 * 1000;

export function makeWindow(days: number, now = new Date(), resolution: UsageResolution = "day"): UsageSummaryInput {
	let timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
	let format: Intl.DateTimeFormat;
	try {
		format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
	} catch {
		timeZone = "UTC";
		format = new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" });
	}
	const untilDay = format.format(now);
	if (resolution === "hour") {
		const untilTimeMs = Math.floor(now.getTime() / 60_000) * 60_000;
		const sinceTimeMs = untilTimeMs - 24 * HOUR_MS;
		const sinceTime = new Date(sinceTimeMs);
		const untilTime = new Date(untilTimeMs);
		return {
			sinceDay: format.format(sinceTime),
			untilDay: format.format(untilTime),
			timeZone,
			resolution,
			sinceTime: sinceTime.toISOString(),
			untilTime: untilTime.toISOString(),
		};
	}
	// Use calendar arithmetic in UTC; fixed millisecond subtraction crosses DST days incorrectly.
	const [year = 0, month = 1, dayOfMonth = 1] = untilDay.split("-").map((part) => Number.parseInt(part, 10));
	const start = new Date(Date.UTC(year, month - 1, dayOfMonth - (days - 1)));
	return {
		sinceDay: start.toISOString().slice(0, 10),
		untilDay,
		timeZone,
		resolution,
	};
}
