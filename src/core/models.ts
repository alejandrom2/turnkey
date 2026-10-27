/**
 * The model catalog as T3 Code's picker shows it: favorites across every provider, else the thread provider's
 * visible models (apps/web/src/components/chat/ModelPickerContent.tsx, apps/web/src/modelSelection.ts), with
 * labels, effort and speed options, and provider marks. Pure, apart from the injected ACP icon fetch.
 */
import { initialsBadgeSvg, PROVIDER_MARKS, providerInstanceInitials } from "./providerIcons.js";
import type { ModelSelection, OptionValue, RuntimeMode } from "./t3/shell.js";

export type ProviderOptionDescriptor =
	| { id: string; label: string; type: "select"; options: { id: string; label: string; isDefault?: boolean }[]; currentValue?: string; promptInjectedValues?: string[] }
	| { id: string; label: string; type: "boolean"; currentValue?: boolean };

export type ConfigModel = {
	slug: string;
	name: string;
	shortName?: string;
	subProvider?: string;
	isCustom?: boolean;
	isLegacy?: boolean;
	isDefault?: boolean;
	capabilities?: { optionDescriptors?: ProviderOptionDescriptor[] } | null;
};

/** A `ServerProvider` from `server.getConfig` (packages/contracts/src/server.ts), the fields the deck reads. */
export type ConfigProvider = {
	instanceId: string;
	driver?: string;
	displayName?: string;
	accentColor?: string;
	iconUrl?: string;
	enabled?: boolean;
	status?: string;
	availability?: string;
	supportedRuntimeModes?: RuntimeMode[];
	showInteractionModeToggle?: boolean;
	requiresNewThreadForModelChange?: boolean;
	models: ConfigModel[];
};

/** `ServerSettings` model preferences: `favorites` null means unmigrated, empty means none (settings.ts:1105). */
export type ModelPreferences = {
	favorites?: { provider: string; model: string }[] | null;
	providerModelPreferences?: Record<string, { hiddenModels?: string[]; modelOrder?: string[] }> | null;
};

export type ModelConfig = { providers?: ConfigProvider[]; settings?: ModelPreferences };

export type ModelOptionInfo = {
	id: string;
	label: string;
	type: "select" | "boolean";
	values: { value: OptionValue; label: string }[];
	/** Prompt-injected values (Claude's Ultrathink): never sent as an option, they prefix the prompt instead. */
	injected?: { value: string; label: string }[];
	default?: OptionValue;
};

/** Options as T3 Code reads them; prompt-injected values (Claude's Ultrathink) are kept apart from the real ones. */
export function optionInfo(descriptor: ProviderOptionDescriptor): ModelOptionInfo {
	if (descriptor.type === "boolean") {
		return {
			id: descriptor.id,
			label: descriptor.label,
			type: "boolean",
			values: [
				{ value: false, label: "Off" },
				{ value: true, label: "On" },
			],
			default: descriptor.currentValue ?? false,
		};
	}
	const injected = new Set(descriptor.promptInjectedValues ?? []);
	return {
		id: descriptor.id,
		label: descriptor.label,
		type: "select",
		values: descriptor.options.filter((choice) => !injected.has(choice.id)).map((choice) => ({ value: choice.id, label: choice.label })),
		...(injected.size > 0 ? { injected: descriptor.options.filter((choice) => injected.has(choice.id)).map((choice) => ({ value: choice.id, label: choice.label })) } : {}),
		default: descriptor.currentValue ?? descriptor.options.find((choice) => choice.isDefault)?.id,
	};
}

/** A thread's value for an option: its own selection, else the provider's current or default value. */
export function currentOptionValue(selection: ModelSelection, option: ModelOptionInfo): OptionValue | undefined {
	return selection.options?.find((selected) => selected.id === option.id)?.value ?? option.default;
}

/** `selection` with option `id` set to `value`, keeping the others. */
export function withOptionValue(selection: ModelSelection, id: string, value: OptionValue): ModelSelection {
	const others = (selection.options ?? []).filter((selected) => selected.id !== id);
	return { ...selection, options: [...others, { id, value }] };
}

export type CatalogModel = {
	/** `instanceId:slug`, the Model key's setting value. */
	key: string;
	instanceId: string;
	slug: string;
	driver: string;
	/** The provider row label: the instance's display name, with any sub-provider. */
	providerName: string;
	/** T3 Code's trigger label: the short name, without a sub-provider prefix. */
	name: string;
	/** "Claude · Opus 4.5", for lists. */
	label: string;
	accentColor: string | undefined;
	iconUrl: string | undefined;
	/** T3 Code adds an initials badge when the instance has an accent color or shares its driver. */
	badge: boolean;
	options: ModelOptionInfo[];
};

export const modelKey = (instanceId: string, slug: string): string => `${instanceId}:${slug}`;

/** Splits a Model key setting on its first ":"; slugs may contain more. */
export function parseModelKey(value: unknown): { instanceId: string; model: string } | undefined {
	if (typeof value !== "string") return undefined;
	const at = value.indexOf(":");
	return at > 0 && at < value.length - 1 ? { instanceId: value.slice(0, at), model: value.slice(at + 1) } : undefined;
}

const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
	antigravity: "Antigravity",
	codex: "Codex",
	claudeAgent: "Claude",
	cursor: "Cursor",
	grok: "Grok",
	fx: "fx",
	muse: "Muse Code",
	acpRegistry: "ACP Registry",
	pi: "Pi",
	opencode: "OpenCode",
};

const humanizeSlug = (slug: string): string =>
	slug
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.trim()
		.replace(/\b\w/g, (char) => char.toUpperCase());

/** Port of `resolveProviderInstanceDisplayName` (packages/client-runtime/src/state/providerInstanceDisplay.ts). */
export function providerDisplayName(provider: Pick<ConfigProvider, "instanceId" | "driver" | "displayName">): string {
	const driver = provider.driver ?? provider.instanceId;
	const named = provider.displayName?.trim();
	const kindLabel = PROVIDER_DISPLAY_NAMES[driver] ?? humanizeSlug(driver);
	if (named && named !== kindLabel) return named;
	if (provider.instanceId !== driver) {
		const humanized = humanizeSlug(provider.instanceId);
		if (humanized.length > 0) return humanized;
	}
	return named || kindLabel;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function stripQualifier(value: string, qualifier: string | undefined): string {
	const trimmed = qualifier?.trim();
	if (!trimmed) return value;
	return value.replace(new RegExp(`^${escapeRegExp(trimmed)}(?:\\s*[.:/-]\\s*|\\s+)`, "iu"), "").trim() || value;
}

function providerRowLabel(providerName: string, subProvider: string | undefined): string {
	const sub = subProvider?.trim();
	if (!sub) return providerName;
	if (providerName.trim() && new RegExp(`^${escapeRegExp(providerName.trim())}\\s+\\S`, "i").test(sub)) return sub;
	return `${providerName} · ${sub}`;
}

/** `isProviderInstancePickerReady` (apps/web/src/providerInstances.ts); a server without `status` counts as ready. */
const pickerReady = (provider: ConfigProvider): boolean =>
	provider.enabled !== false && provider.availability !== "unavailable" && (provider.status === undefined || provider.status === "ready");

/** A provider's models after its hidden list, in its saved order, then the server's (`applyInstanceModelPreferences`). */
function visibleModels(config: ModelConfig, provider: ConfigProvider): ConfigModel[] {
	const preferences = config.settings?.providerModelPreferences?.[provider.instanceId];
	const hidden = new Set(preferences?.hiddenModels ?? []);
	const rank = new Map((preferences?.modelOrder ?? []).map((slug, index) => [slug, index]));
	return provider.models
		.map((model, index) => ({ model, index }))
		.filter(({ model }) => model.isCustom === true || !hidden.has(model.slug))
		.sort((a, b) => (rank.get(a.model.slug) ?? Infinity) - (rank.get(b.model.slug) ?? Infinity) || a.index - b.index)
		.map(({ model }) => model);
}

function entry(config: ModelConfig, provider: ConfigProvider, model: ConfigModel): CatalogModel {
	const driver = provider.driver ?? provider.instanceId;
	const providerName = providerRowLabel(providerDisplayName(provider), model.subProvider);
	const name = stripQualifier(model.shortName || model.name, model.subProvider);
	const sameDriver = (config.providers ?? []).filter((other) => (other.driver ?? other.instanceId) === driver).length;
	return {
		key: modelKey(provider.instanceId, model.slug),
		instanceId: provider.instanceId,
		slug: model.slug,
		driver,
		providerName,
		name,
		label: `${providerName} · ${name}`,
		accentColor: provider.accentColor,
		iconUrl: provider.iconUrl,
		badge: /^#[0-9a-f]{6}$/i.test(provider.accentColor?.trim() ?? "") || sameDriver > 1,
		options: (model.capabilities?.optionDescriptors ?? []).map(optionInfo),
	};
}

/**
 * T3 Code's favorites, in its Favorites tab order: by provider (the config's order), then each provider's
 * visible order. Undefined when there are none yet (null is an unmigrated server, empty is none).
 */
export function favoriteModels(config: ModelConfig | undefined): CatalogModel[] | undefined {
	const favorites = config?.settings?.favorites;
	if (config === undefined || favorites == null || favorites.length === 0) return undefined;
	const starred = new Set(favorites.map((favorite) => modelKey(favorite.provider, favorite.model)));
	const models = (config.providers ?? [])
		.filter(pickerReady)
		.flatMap((provider) => visibleModels(config, provider).filter((model) => starred.has(modelKey(provider.instanceId, model.slug))).map((model) => entry(config, provider, model)));
	return models.length > 0 ? models : undefined;
}

/** One provider's models as its picker tab lists them; legacy models stay folded away. */
export function providerModels(config: ModelConfig | undefined, instanceId: string): CatalogModel[] {
	const provider = config?.providers?.find((candidate) => candidate.instanceId === instanceId);
	if (config === undefined || provider === undefined || !pickerReady(provider)) return [];
	return visibleModels(config, provider)
		.filter((model) => model.isLegacy !== true)
		.map((model) => entry(config, provider, model));
}

/** What a Model key cycles through: favorites, else the current provider's visible models. */
export function modelCatalog(config: ModelConfig | undefined, current?: Pick<ModelSelection, "instanceId">): CatalogModel[] {
	return favoriteModels(config) ?? (current === undefined ? [] : providerModels(config, current.instanceId));
}

/** What a Model key may be set to: favorites, else every ready provider's visible models. */
export function pickableModels(config: ModelConfig | undefined): CatalogModel[] {
	return favoriteModels(config) ?? (config?.providers ?? []).flatMap((provider) => providerModels(config, provider.instanceId));
}

/** Any configured model, hidden or legacy included, for showing what a thread runs on. */
export function findModel(config: ModelConfig | undefined, selection: Pick<ModelSelection, "instanceId" | "model">): CatalogModel | undefined {
	const provider = config?.providers?.find((candidate) => candidate.instanceId === selection.instanceId);
	const model = provider?.models.find((candidate) => candidate.slug === selection.model);
	return config === undefined || provider === undefined || model === undefined ? undefined : entry(config, provider, model);
}

/** The model after `current` in `catalog`, wrapping; the first when `current` is not in it. */
export function nextModel(catalog: readonly CatalogModel[], current: Pick<ModelSelection, "instanceId" | "model">): CatalogModel | undefined {
	const index = catalog.findIndex((model) => model.key === modelKey(current.instanceId, current.model));
	return catalog[(index + 1) % catalog.length];
}

/**
 * The selection that switches to `target`. T3 Code's composer restores options it remembers per model; the deck
 * keeps the current ones the target also offers, so effort survives a switch where it can.
 */
export function switchSelection(target: CatalogModel, current: ModelSelection): ModelSelection {
	const kept = (current.options ?? []).filter((selected) =>
		target.options.some((option) => option.id === selected.id && option.values.some((choice) => choice.value === selected.value)),
	);
	return { instanceId: target.instanceId, model: target.slug, ...(kept.length > 0 ? { options: kept } : {}) };
}

/** T3 Code's access modes, in its menu order and words. */
export const RUNTIME_MODES: readonly { value: RuntimeMode; label: string }[] = [
	{ value: "approval-required", label: "Supervised" },
	{ value: "auto-accept-edits", label: "Auto-accept edits" },
	{ value: "auto", label: "Auto" },
	{ value: "full-access", label: "Full access" },
];

/** The access modes `instanceId` supports; every mode when the provider doesn't say. */
export function runtimeModes(config: ModelConfig | undefined, instanceId: string): readonly { value: RuntimeMode; label: string }[] {
	const supported = config?.providers?.find((provider) => provider.instanceId === instanceId)?.supportedRuntimeModes;
	return supported === undefined ? RUNTIME_MODES : RUNTIME_MODES.filter((mode) => supported.includes(mode.value));
}

/** The value after `current` in `values`, wrapping; the first when `current` is not among them. */
export function cycleValue<V>(values: readonly V[], current: V | undefined): V | undefined {
	return values[(values.indexOf(current as V) + 1) % values.length];
}

/** `REASONING_EFFORT_OPTION_IDS` (packages/client-runtime/src/state/threadExecution.ts), in T3's order. */
const EFFORT_IDS = ["reasoningEffort", "effort", "reasoning", "variant", "reasoning_effort"];

export function effortOption(model: Pick<CatalogModel, "options"> | undefined): ModelOptionInfo | undefined {
	for (const id of EFFORT_IDS) {
		const option = model?.options.find((candidate) => candidate.id === id && candidate.type === "select");
		if (option !== undefined && option.values.length > 0) return option;
	}
	return undefined;
}

/** Every effort value any model on the machine offers, first label wins, then prompt-injected ones (Ultrathink), for the Effort key's settings. */
export function effortValues(config: ModelConfig | undefined): { value: string; label: string }[] {
	const seen = new Map<string, string>();
	const injected = new Map<string, string>();
	for (const provider of config?.providers ?? []) {
		if (!pickerReady(provider)) continue;
		for (const model of provider.models) {
			const option = effortOption({ options: (model.capabilities?.optionDescriptors ?? []).map(optionInfo) });
			for (const choice of option?.values ?? []) if (!seen.has(String(choice.value))) seen.set(String(choice.value), choice.label);
			for (const choice of option?.injected ?? []) if (!injected.has(choice.value)) injected.set(choice.value, choice.label);
		}
	}
	for (const [value, label] of injected) if (!seen.has(value)) seen.set(value, label);
	return [...seen].map(([value, label]) => ({ value, label }));
}

export type SpeedToggle = { option: ModelOptionInfo; fast: boolean; label: string; next: OptionValue; nextLabel: string };

/**
 * The model's fast switch, as T3 Code's traits menu reads it (packages/client-runtime/src/modelTraits.ts): Claude's
 * `fastMode`, or a Codex service tier labeled "Fast" against "default". Undefined when the model has neither.
 */
export function speedToggle(model: Pick<CatalogModel, "options" | "driver"> | undefined, selection: ModelSelection): SpeedToggle | undefined {
	const fastMode = model?.options.find((option) => option.id === "fastMode" && option.type === "boolean");
	if (fastMode !== undefined) {
		const fast = currentOptionValue(selection, fastMode) === true;
		return { option: fastMode, fast, label: fast ? "Fast" : "Normal", next: !fast, nextLabel: fast ? "Normal" : "Fast" };
	}
	const tier = model?.driver === "codex" ? model.options.find((option) => option.id === "serviceTier" && option.type === "select") : undefined;
	const fastTier = tier?.values.find((choice) => choice.label === "Fast");
	const standard = tier?.values.find((choice) => choice.value === "default");
	if (tier === undefined || fastTier === undefined || standard === undefined) return undefined;
	const fast = currentOptionValue(selection, tier) === fastTier.value;
	return fast
		? { option: tier, fast, label: fastTier.label, next: standard.value, nextLabel: standard.label }
		: { option: tier, fast, label: standard.label, next: fastTier.value, nextLabel: fastTier.label };
}

/** `resolveOfficialAcpRegistryIconUrl` (packages/contracts/src/acpRegistry.ts): only the registry CDN is fetched. */
export function officialAcpIconUrl(icon: string | undefined): string | undefined {
	if (!icon) return undefined;
	try {
		const url = new URL(icon);
		if (url.protocol !== "https:" || url.hostname !== "cdn.agentclientprotocol.com" || url.port !== "" || url.username !== "" || url.password !== "") return undefined;
		return url.href;
	} catch {
		return undefined;
	}
}

export type MarkArt = { viewBox: string; body: string };

/**
 * A registry SVG made safe and one color, as T3 Code tints it: no scripts, events, styles, foreign content or
 * outside references, and every paint becomes `currentColor`. Done in the markup because Stream Deck's SVG
 * renderer can't be relied on for filters.
 */
export function sanitizeIconSvg(text: string): MarkArt | undefined {
	const match = /<svg\b([^>]*)>([\s\S]*)<\/svg>\s*$/i.exec(text.trim());
	if (match === null) return undefined;
	const [, attributes, inner] = match;
	const attribute = (name: string) => new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, "i").exec(attributes)?.[1];
	const width = Number.parseFloat(attribute("width") ?? "");
	const height = Number.parseFloat(attribute("height") ?? "");
	const viewBox = attribute("viewBox") ?? (width > 0 && height > 0 ? `0 0 ${width} ${height}` : "0 0 24 24");
	if (!/^[-\d.\s,eE]+$/.test(viewBox)) return undefined;
	const body = inner
		.replace(/<(script|style|foreignObject|image)\b[\s\S]*?<\/\1\s*>/gi, "")
		.replace(/<(script|style|foreignObject|image)\b[^>]*\/>/gi, "")
		.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, "")
		.replace(/\s(?:xlink:)?href\s*=\s*("(?!#)[^"]*"|'(?!#)[^']*')/gi, "")
		.replace(/\s(fill|stroke|stop-color|color)\s*=\s*("(?!\s*(?:none|transparent)\s*")[^"]*"|'(?!\s*(?:none|transparent)\s*')[^']*')/gi, ` $1="currentColor"`)
		.replace(/(fill|stroke|stop-color|color)\s*:\s*(?!(?:none|transparent)\b)[^;"'\s][^;"']*/gi, "$1:currentColor");
	return body.trim() ? { viewBox, body } : undefined;
}

const ICON_MAX_BYTES = 100_000;
const ICON_TIMEOUT_MS = 10_000;

/** Registry icons by URL, fetched once; failures are remembered too, so they fall back to the generic ACP mark. */
export class AcpIcons {
	readonly #cache = new Map<string, MarkArt | null>();
	readonly #fetch: typeof fetch;
	readonly #onLoad: () => void;

	constructor(fetchFn: typeof fetch, onLoad: () => void) {
		this.#fetch = fetchFn;
		this.#onLoad = onLoad;
	}

	/** The icon for `iconUrl` once loaded; undefined while loading, on failure or for a URL outside the CDN. */
	get(iconUrl: string | undefined): MarkArt | undefined {
		const url = officialAcpIconUrl(iconUrl);
		if (url === undefined) return undefined;
		if (!this.#cache.has(url)) {
			this.#cache.set(url, null);
			void this.#load(url);
		}
		return this.#cache.get(url) ?? undefined;
	}

	async #load(url: string): Promise<void> {
		try {
			const response = await this.#fetch(url, { redirect: "error", signal: AbortSignal.timeout(ICON_TIMEOUT_MS) });
			const text = response.ok ? await response.text() : "";
			const art = text.length <= ICON_MAX_BYTES ? sanitizeIconSvg(text) : undefined;
			if (art === undefined) return;
			this.#cache.set(url, art);
			this.#onLoad();
		} catch {
			// Stays null: the generic mark.
		}
	}
}

/** `art` fitted and centered in a `size` box at (x, y), as a transformed group like every other key glyph. */
function placed(x: number, y: number, size: number, art: MarkArt, color: string, fill: string): string {
	const [minX, minY, width, height] = art.viewBox.split(/[\s,]+/).map(Number);
	const scale = size / Math.max(width, height);
	const left = x + (size - width * scale) / 2 - minX * scale;
	const top = y + (size - height * scale) / 2 - minY * scale;
	return `<g transform="translate(${left} ${top}) scale(${scale})" color="${color}" fill="${fill}">${art.body}</g>`;
}

/** T3 Code's initials badge, moved to (x, y). */
const badgeAt = (x: number, y: number, ...args: Parameters<typeof initialsBadgeSvg>) =>
	`<g transform="translate(${x} ${y})">${initialsBadgeSvg(...args).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>`;

/**
 * A model's provider mark at (x, y), as T3 Code's `ProviderInstanceIcon` draws it: the driver's mark, a
 * registry agent's own icon in one color (the generic ACP mark until it loads), or initials for an unknown
 * driver; with an initials badge when the instance needs telling apart.
 */
export function providerMark(
	model: Pick<CatalogModel, "driver" | "providerName" | "accentColor" | "iconUrl" | "badge">,
	x: number,
	y: number,
	size: number,
	options: { color?: string; acpIcons?: Pick<AcpIcons, "get"> } = {},
): string {
	const parts: string[] = [];
	const known = PROVIDER_MARKS[model.driver];
	const registry = model.driver === "acpRegistry" ? options.acpIcons?.get(model.iconUrl) : undefined;
	if (registry !== undefined) parts.push(placed(x, y, size, registry, options.color ?? "#FFFFFF", "currentColor"));
	else if (known !== undefined) parts.push(placed(x, y, size, known, options.color ?? known.color, known.fill === "currentColor" ? "currentColor" : "none"));
	else parts.push(badgeAt(x, y, model.providerName, model.accentColor, size));
	if (model.badge && (known !== undefined || registry !== undefined) && providerInstanceInitials(model.providerName)) {
		const badge = Math.round(size * 0.46);
		parts.push(badgeAt(x + size - badge * 0.8, y + size - badge * 0.8, model.providerName, model.accentColor, badge));
	}
	return parts.join("");
}
