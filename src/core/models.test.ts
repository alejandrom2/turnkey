import { describe, expect, it, vi } from "vitest";

import {
	AcpIcons,
	cycleValue,
	effortOption,
	effortValues,
	favoriteModels,
	findModel,
	type ModelConfig,
	modelCatalog,
	nextModel,
	officialAcpIconUrl,
	parseModelKey,
	pickableModels,
	providerDisplayName,
	providerMark,
	providerModels,
	runtimeModes,
	sanitizeIconSvg,
	speedToggle,
	switchSelection,
} from "./models.js";

const effort = (ids: string[], id = "effort") => ({
	id,
	label: "Reasoning",
	type: "select" as const,
	options: ids.map((value, index) => ({ id: value, label: value[0].toUpperCase() + value.slice(1), ...(index === 0 ? { isDefault: true } : {}) })),
});

const CONFIG: ModelConfig = {
	providers: [
		{
			instanceId: "codex",
			driver: "codex",
			displayName: "Codex",
			status: "ready",
			enabled: true,
			models: [
				{
					slug: "gpt-5.5",
					name: "GPT-5.5",
					capabilities: {
						optionDescriptors: [
							effort(["medium", "high", "xhigh"], "reasoningEffort"),
							{
								id: "serviceTier",
								label: "Service Tier",
								type: "select",
								options: [
									{ id: "default", label: "Standard", isDefault: true },
									{ id: "priority", label: "Fast" },
								],
								currentValue: "default",
							},
						],
					},
				},
				{ slug: "gpt-5.5-mini", name: "GPT-5.5 Mini", shortName: "5.5 Mini" },
				{ slug: "gpt-4", name: "GPT-4", isLegacy: true },
			],
		},
		{
			instanceId: "claudeAgent",
			driver: "claudeAgent",
			displayName: "Claude",
			status: "ready",
			enabled: true,
			supportedRuntimeModes: ["approval-required", "full-access"],
			models: [
				{
					slug: "claude-opus-4-5",
					name: "Claude Opus 4.5",
					shortName: "Opus 4.5",
					capabilities: { optionDescriptors: [{ ...effort(["low", "high", "ultrathink"]), promptInjectedValues: ["ultrathink"] }, { id: "fastMode", label: "Fast", type: "boolean" }] },
				},
				{ slug: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", shortName: "Sonnet 4.5", capabilities: { optionDescriptors: [effort(["low", "max"])] } },
				{ slug: "claude-haiku", name: "Claude Haiku", shortName: "Haiku" },
			],
		},
		{ instanceId: "cursor", driver: "cursor", status: "error", enabled: true, models: [{ slug: "auto", name: "Auto" }] },
	],
	settings: {
		favorites: [
			{ provider: "claudeAgent", model: "claude-sonnet-4-5" },
			{ provider: "codex", model: "gpt-5.5" },
			{ provider: "claudeAgent", model: "claude-opus-4-5" },
			{ provider: "claudeAgent", model: "claude-haiku" },
			{ provider: "cursor", model: "auto" },
		],
		providerModelPreferences: { claudeAgent: { hiddenModels: ["claude-haiku"], modelOrder: ["claude-opus-4-5"] } },
	},
};

const keys = (models: { key: string }[] | undefined) => models?.map((model) => model.key);

describe("favorites", () => {
	it("lists T3 Code's favorites by provider, then each provider's saved order, without hidden or unready ones", () => {
		expect(keys(favoriteModels(CONFIG))).toEqual(["codex:gpt-5.5", "claudeAgent:claude-opus-4-5", "claudeAgent:claude-sonnet-4-5"]);
	});

	it("labels models the way T3 Code's picker does", () => {
		const [codex, opus] = favoriteModels(CONFIG)!;
		expect(codex).toMatchObject({ providerName: "Codex", name: "GPT-5.5", label: "Codex · GPT-5.5", driver: "codex", badge: false });
		expect(opus).toMatchObject({ providerName: "Claude", name: "Opus 4.5", label: "Claude · Opus 4.5" });
		expect(opus.options.find((option) => option.id === "effort")?.values.map((choice) => choice.value)).toEqual(["low", "high"]);
	});

	it("falls back to the thread provider's visible models when favorites are null (unmigrated) or empty", () => {
		for (const favorites of [null, []]) {
			const config = { ...CONFIG, settings: { ...CONFIG.settings, favorites } };
			expect(favoriteModels(config)).toBeUndefined();
			expect(keys(modelCatalog(config, { instanceId: "claudeAgent" }))).toEqual(["claudeAgent:claude-opus-4-5", "claudeAgent:claude-sonnet-4-5"]);
			expect(keys(modelCatalog(config, { instanceId: "codex" }))).toEqual(["codex:gpt-5.5", "codex:gpt-5.5-mini"]);
			expect(keys(pickableModels(config))).toEqual(["codex:gpt-5.5", "codex:gpt-5.5-mini", "claudeAgent:claude-opus-4-5", "claudeAgent:claude-sonnet-4-5"]);
		}
		expect(keys(modelCatalog(CONFIG, { instanceId: "codex" }))).toEqual(keys(favoriteModels(CONFIG)));
		expect(providerModels(CONFIG, "cursor")).toEqual([]);
	});

	it("finds any configured model for showing what a thread runs on, hidden ones included", () => {
		expect(findModel(CONFIG, { instanceId: "claudeAgent", model: "claude-haiku" })?.name).toBe("Haiku");
		expect(findModel(CONFIG, { instanceId: "claudeAgent", model: "gone" })).toBeUndefined();
		expect(findModel(undefined, { instanceId: "codex", model: "gpt-5.5" })).toBeUndefined();
	});
});

describe("provider labels", () => {
	it("resolves instance names like T3 Code", () => {
		expect(providerDisplayName({ instanceId: "claudeAgent", driver: "claudeAgent" })).toBe("Claude");
		expect(providerDisplayName({ instanceId: "codex_work", driver: "codex" })).toBe("Codex Work");
		expect(providerDisplayName({ instanceId: "codex_work", driver: "codex", displayName: "Work" })).toBe("Work");
		expect(providerDisplayName({ instanceId: "newAgent", driver: "newAgent" })).toBe("New Agent");
	});

	it("names a sub-provider and strips it from the model, and badges instances that need telling apart", () => {
		const config: ModelConfig = {
			providers: [
				{ instanceId: "opencode", driver: "opencode", models: [{ slug: "anthropic/sonnet", name: "Anthropic: Sonnet", subProvider: "Anthropic" }] },
				{ instanceId: "codex", driver: "codex", models: [{ slug: "a", name: "A" }] },
				{ instanceId: "codex_work", driver: "codex", accentColor: "#336699", models: [{ slug: "a", name: "A" }] },
			],
		};
		expect(findModel(config, { instanceId: "opencode", model: "anthropic/sonnet" })).toMatchObject({ providerName: "OpenCode · Anthropic", name: "Sonnet", badge: false });
		expect(findModel(config, { instanceId: "codex", model: "a" })?.badge).toBe(true);
		expect(findModel(config, { instanceId: "codex_work", model: "a" })?.label).toBe("Codex Work · A");
	});
});

describe("switching", () => {
	it("reads Model key values, whose slugs may hold colons", () => {
		expect(parseModelKey("opencode:anthropic:sonnet")).toEqual({ instanceId: "opencode", model: "anthropic:sonnet" });
		expect(parseModelKey("")).toBeUndefined();
		expect(parseModelKey("codex:")).toBeUndefined();
	});

	it("steps to the next model, wrapping, and starts over from a model outside the list", () => {
		const catalog = favoriteModels(CONFIG)!;
		expect(nextModel(catalog, { instanceId: "codex", model: "gpt-5.5" })?.key).toBe("claudeAgent:claude-opus-4-5");
		expect(nextModel(catalog, { instanceId: "claudeAgent", model: "claude-sonnet-4-5" })?.key).toBe("codex:gpt-5.5");
		expect(nextModel(catalog, { instanceId: "claudeAgent", model: "claude-haiku" })?.key).toBe("codex:gpt-5.5");
		expect(nextModel([], { instanceId: "codex", model: "gpt-5.5" })).toBeUndefined();
	});

	it("keeps only the options the target model offers with the same value", () => {
		const sonnet = findModel(CONFIG, { instanceId: "claudeAgent", model: "claude-sonnet-4-5" })!;
		const opus = { instanceId: "claudeAgent", model: "claude-opus-4-5", options: [{ id: "effort", value: "low" }, { id: "fastMode", value: true }] };
		expect(switchSelection(sonnet, opus)).toEqual({ instanceId: "claudeAgent", model: "claude-sonnet-4-5", options: [{ id: "effort", value: "low" }] });
		expect(switchSelection(sonnet, { ...opus, options: [{ id: "effort", value: "high" }] })).toEqual({ instanceId: "claudeAgent", model: "claude-sonnet-4-5" });
	});

	it("switches across providers with the target's instance and none of the old provider's options", () => {
		const gpt = findModel(CONFIG, { instanceId: "codex", model: "gpt-5.5" })!;
		expect(switchSelection(gpt, { instanceId: "claudeAgent", model: "claude-opus-4-5", options: [{ id: "effort", value: "high" }] })).toEqual({ instanceId: "codex", model: "gpt-5.5" });
	});
});

describe("effort and speed", () => {
	const gpt = () => findModel(CONFIG, { instanceId: "codex", model: "gpt-5.5" })!;
	const opus = () => findModel(CONFIG, { instanceId: "claudeAgent", model: "claude-opus-4-5" })!;

	it("finds effort under T3 Code's reasoning option ids, without prompt-injected values", () => {
		expect(effortOption(gpt())?.id).toBe("reasoningEffort");
		expect(effortOption(opus())?.values.map((choice) => choice.label)).toEqual(["Low", "High"]);
		expect(effortOption(findModel(CONFIG, { instanceId: "claudeAgent", model: "claude-haiku" }))).toBeUndefined();
		expect(effortValues(CONFIG).map((choice) => choice.value)).toEqual(["medium", "high", "xhigh", "low", "max"]);
	});

	it("toggles Claude's fast mode", () => {
		const selection = { instanceId: "claudeAgent", model: "claude-opus-4-5" };
		expect(speedToggle(opus(), selection)).toMatchObject({ fast: false, label: "Normal", next: true });
		expect(speedToggle(opus(), { ...selection, options: [{ id: "fastMode", value: true }] })).toMatchObject({ fast: true, label: "Fast", next: false });
	});

	it("toggles Codex between the Standard and Fast tiers, and offers nothing where a model has neither", () => {
		const selection = { instanceId: "codex", model: "gpt-5.5" };
		expect(speedToggle(gpt(), selection)).toMatchObject({ fast: false, label: "Standard", next: "priority", nextLabel: "Fast" });
		expect(speedToggle(gpt(), { ...selection, options: [{ id: "serviceTier", value: "priority" }] })).toMatchObject({ fast: true, next: "default" });
		expect(speedToggle(findModel(CONFIG, { instanceId: "codex", model: "gpt-5.5-mini" }), selection)).toBeUndefined();
		expect(speedToggle({ ...gpt(), driver: "opencode" }, selection)).toBeUndefined();
	});

	it("offers only the access modes a provider supports, and cycles values", () => {
		expect(runtimeModes(CONFIG, "claudeAgent").map((mode) => mode.label)).toEqual(["Supervised", "Full access"]);
		expect(runtimeModes(CONFIG, "codex")).toHaveLength(4);
		expect(cycleValue(["a", "b"], "b")).toBe("a");
		expect(cycleValue(["a", "b"], undefined)).toBe("a");
		expect(cycleValue([], "a")).toBeUndefined();
	});
});

describe("provider marks", () => {
	const model = (driver: string, extra: object = {}) => ({ driver, providerName: "Agent", accentColor: undefined, iconUrl: undefined, badge: false, ...extra });

	it("draws the driver's mark, initials for an unknown driver, and a badge when asked", () => {
		expect(providerMark(model("claudeAgent"), 10, 20, 40)).toMatch(/^<g transform="translate\([\d.]+ 20\) scale\([\d.]+\)" color="#d97757" fill="currentColor"><path /);
		const scale = 40 / 411;
		expect(providerMark(model("codex"), 0, 0, 40)).toContain(`transform="translate(${-100 * scale} ${-100 * scale}) scale(${scale})"`);
		expect(providerMark(model("unknown"), 0, 0, 40)).toContain(">AG</text>");
		expect(providerMark(model("codex", { badge: true, accentColor: "#336699" }), 0, 0, 40)).toContain(`fill="#336699"`);
	});

	it("uses a registry agent's own icon once loaded, the generic ACP mark until then", () => {
		const art = { viewBox: "0 0 16 16", body: `<path d="M0 0h16v16z"/>` };
		const acp = model("acpRegistry", { iconUrl: "https://cdn.agentclientprotocol.com/registry/v1/latest/kiro.svg" });
		expect(providerMark(acp, 0, 0, 40, { acpIcons: { get: () => undefined } })).toContain("M568.003");
		expect(providerMark(acp, 0, 0, 40, { acpIcons: { get: () => art } })).toBe(`<g transform="translate(0 0) scale(2.5)" color="#FFFFFF" fill="currentColor"><path d="M0 0h16v16z"/></g>`);
	});
});

describe("ACP registry icons", () => {
	it("fetches only from the registry CDN", () => {
		expect(officialAcpIconUrl("https://cdn.agentclientprotocol.com/registry/v1/latest/kiro.svg")).toBe("https://cdn.agentclientprotocol.com/registry/v1/latest/kiro.svg");
		for (const url of ["http://cdn.agentclientprotocol.com/a.svg", "https://cdn.agentclientprotocol.com:8443/a.svg", "https://evil.example/a.svg", "https://u:p@cdn.agentclientprotocol.com/a.svg", "nope"]) {
			expect(officialAcpIconUrl(url)).toBeUndefined();
		}
	});

	it("strips scripts, handlers, styles and outside references, and paints everything one colour", () => {
		const art = sanitizeIconSvg(
			`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" onload="x()"><script>alert(1)</script><style>.a{fill:red}</style>` +
				`<path d="M1 1" fill="#ff0000" onclick="y()"/><circle style="stroke: blue; opacity: .5" fill="none"/><rect style="fill: none; stroke: #000" fill="transparent"/>` +
				`<use href="https://evil.example/x.svg#a"/><use href="#local"/><image href="https://x/y.png"/></svg>`,
		)!;
		expect(art.viewBox).toBe("0 0 24 24");
		expect(art.body).not.toMatch(/script|onclick|onload|style>|evil|image|#ff0000|blue/);
		expect(art.body).toContain(`fill="currentColor"`);
		expect(art.body).toContain(`fill="none"`);
		expect(art.body).toContain("stroke:currentColor");
		expect(art.body).toContain(`style="fill: none; stroke:currentColor"`);
		expect(art.body).toContain(`fill="transparent"`);
		expect(art.body).toContain(`href="#local"`);
		expect(sanitizeIconSvg("<html>not an svg</html>")).toBeUndefined();
	});

	it("loads each icon once, remembers failures, and repaints when one arrives", async () => {
		const ok = "https://cdn.agentclientprotocol.com/registry/v1/latest/ok.svg";
		const bad = "https://cdn.agentclientprotocol.com/registry/v1/latest/bad.svg";
		const fetchFn = vi.fn(async (url: string | URL | Request) =>
			String(url) === ok ? new Response(`<svg viewBox="0 0 8 8"><path d="M0 0"/></svg>`) : new Response("", { status: 404 }),
		) as unknown as typeof fetch;
		const onLoad = vi.fn();
		const icons = new AcpIcons(fetchFn, onLoad);
		expect(icons.get(ok)).toBeUndefined();
		expect(icons.get(bad)).toBeUndefined();
		expect(icons.get("https://evil.example/x.svg")).toBeUndefined();
		await vi.waitFor(() => expect(onLoad).toHaveBeenCalledTimes(1));
		expect(icons.get(ok)).toEqual({ viewBox: "0 0 8 8", body: `<path d="M0 0"/>` });
		expect(icons.get(bad)).toBeUndefined();
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});
});
