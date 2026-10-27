// Writes the property inspectors and the T3 Deck Settings window they open: `node scripts/ui.ts`.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { FEATURES } from "../src/core/features.ts";
import { machineSummary, mergeGlobalSettings, needsFirstPairing } from "../src/core/panel.ts";

const plugin = join(import.meta.dirname, "..", "com.alejandrom2.t3deck.sdPlugin");
const dir = join(plugin, "ui");

/**
 * Copy comes from en.json's "Localization", written in as English. Elements name their key in `data-i18n` (text) or
 * `data-i18n-<attribute>`; on load the inspector asks the plugin for the current language's table and swaps them.
 */
const messages: { inspector: { card: Record<string, string> } } = JSON.parse(readFileSync(join(plugin, "en.json"), "utf8")).Localization;

const msg = (key: string): string => {
	const value = key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], messages);
	if (typeof value !== "string") throw new Error(`en.json has no Localization.${key}`);
	return value;
};

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/** Closes an opening tag with the key's text as its content: `<p class="hint"${text(key)}</p>`. */
const text = (key: string) => ` data-i18n="${key}">${escape(msg(key))}`;

/** A localized attribute: `label`, `placeholder`, `loading` or `aria-label`. */
const attr = (name: string, key: string) => `${name}="${escape(msg(key))}" data-i18n-${name}="${key}"`;

/** Pages build some copy at runtime, so they carry the English table to fall back on until the plugin sends its own. */
const cardStrings = Object.fromEntries(Object.keys(messages.inspector.card).map((name) => [`inspector.card.${name}`, msg(`inspector.card.${name}`)]));

/** The same pure helpers the plugin's tests cover, as plain JS (Node strips their types). */
const helpers = [machineSummary, needsFirstPairing, mergeGlobalSettings].map((fn) => fn.toString().replace(/ {2,}/g, " ")).join("\n");

const manifest: { Version: string } = JSON.parse(readFileSync(join(plugin, "manifest.json"), "utf8"));

/** sdpi-components' font and Stream Deck's grays, shared by the panels and the settings window. */
const baseStyle = `
			:root { color-scheme: dark; --t3-warning: #fcd34d; }
			body { font-family: "Segoe UI", Arial, Roboto, Helvetica, sans-serif; font-size: 9pt; }
			[hidden] { display: none !important; }
			.native { width: 100%; box-sizing: border-box; height: 24px; padding: 0 6px; font: inherit; color: #d8d8d8; background: #3d3d3d; border: 0; border-radius: 3px; }
			.native::placeholder { color: #8f8f8f; }
			button.sd { height: 22px; padding: 0 9px; white-space: nowrap; font: inherit; color: #d8d8d8; background: #3d3d3d; border: 0; border-radius: 3px; cursor: pointer; }
			button.sd:hover { background: #474747; }
			button.sd:disabled { opacity: .45; cursor: default; }
			button.text { padding: 0; font: inherit; color: #8fb3ff; background: none; border: 0; cursor: pointer; }
			.state { white-space: nowrap; }
			.state::before { content: "●"; margin-right: 4px; }
			.state.ok { color: #40c977; }
			.state.wait { color: var(--t3-warning); }
			.state.muted { color: #8f8f8f; }
			.state.error { color: #f87171; }`;

const style = `
		<style>${baseStyle}
			main { display: grid; gap: 2px; }
			.hint { color: #a8a8a8; line-height: 1.4; margin: -2px 0 8px 106px; font-size: 9pt; }
			/* What broader access an action needs, said plainly. */
			.hint.access { color: var(--t3-warning); }
			.hint.error { color: #f87171; }
			.link { width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit; color: #d8d8d8; background: #2d2d2d; border: 1px solid #3d3d3d; border-radius: 3px; }
			.open { display: flex; align-items: center; gap: 6px; min-width: 0; }
			.open .state { overflow: hidden; text-overflow: ellipsis; }
			.pair { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px; }
			details.group { border-top: 1px solid #555; margin-top: 10px; padding-top: 8px; }
			details.group > summary {
				cursor: pointer; margin: 0 0 8px; font-size: 8.5pt; font-weight: 600;
				letter-spacing: .06em; text-transform: uppercase; color: #a8a8a8;
			}
		</style>`;

const confirmOptions = `
						<option value="review"${text("inspector.confirm.review")}</option>
						<option value="hold"${text("inspector.confirm.hold")}</option>
						<option value="off"${text("inspector.confirm.off")}</option>`;

/** An action's own Confirm before sending, over the global one in T3 Deck Settings. */
const confirmField = `
			<sdpi-item ${attr("label", "inspector.field.confirm")}>
				<sdpi-select setting="confirmSend" default="">
					<option value=""${text("inspector.background.global")}</option>${confirmOptions.replace(/\t\t\t\t\t\t</g, "\t\t\t\t\t<")}
				</sdpi-select>
			</sdpi-item>`;

/** Elgato's "What this action needs": each condition met (✓), not met (✗) or being checked (⋯), with its fixes. */
const needsStyle = `
		<style>
			details.needs > summary .count.unmet { color: #f87171; }
			.needs ul { list-style: none; margin: 0 0 6px; padding: 0; display: grid; gap: 6px; }
			.needs li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 2px 6px; font-size: 9pt; line-height: 1.35; color: #d8d8d8; }
			.needs li .mark { font-weight: 700; text-align: center; }
			.needs li[data-state="met"] .mark { color: #34d399; }
			.needs li[data-state="unmet"] .mark { color: #f87171; }
			.needs li[data-state="checking"] .mark { color: #a8a8a8; }
			.needs li .fix { grid-column: 2; color: #a8a8a8; }
		</style>`;

const needs = `
			<details class="group needs" id="needs" hidden>
				<summary><span${text("inspector.card.needsTitle")}</span><span class="count" id="needs-count"></span></summary>
				<ul id="needs-list"></ul>
			</details>`;

/** The machine this action follows, the way into T3 Deck Settings, and a pair link field until something is paired. */
const card = `
			<sdpi-item ${attr("label", "inspector.card.machine")}>
				<select class="native" id="t3-machine" ${attr("aria-label", "inspector.card.machineGroup")}></select>
			</sdpi-item>
			<sdpi-item>
				<div class="open">
					<button class="sd" id="t3-open-settings" type="button"${text("inspector.settings.open")}</button>
					<span class="state muted" id="t3-summary" aria-live="polite"${text("inspector.card.looking")}</span>
				</div>
			</sdpi-item>
			<p class="hint error" id="t3-blocked" hidden${text("inspector.settings.blocked")}</p>
			<div id="t3-first" hidden>
				<p class="hint" id="t3-lede"></p>
				<sdpi-item ${attr("label", "inspector.card.addMachine")}>
					<div class="pair">
						<input class="native" id="t3-link" type="url" autocomplete="off" spellcheck="false" ${attr("placeholder", "inspector.card.linkPlaceholder")} />
						<button class="sd" id="t3-pair" type="button" disabled${text("inspector.card.connect")}</button>
					</div>
				</sdpi-item>
				<p class="hint error" id="t3-result" hidden></p>
			</div>`;

/** Shows the element `id` only while the action's `setting` passes `test`, as it is edited and as settings arrive. */
const showWhen = (setting: string, id: string, test: string) => `
			{
				const field = document.querySelector('[setting="${setting}"]');
				const apply = (value) => { $("${id}").hidden = !((value) => ${test})(value ?? ""); };
				field.addEventListener("valuechange", () => apply(field.value));
				client.getSettings().then((payload) => apply(payload?.settings?.["${setting}"]));
				client.didReceiveSettings.subscribe(({ payload }) => apply(payload?.settings?.["${setting}"]));
			}`;

/**
 * A merged action's mode, first in its panel. `fallback` is the mode this page's UUID starts in: an older
 * single-purpose key opens the merged panel with its own mode selected, with nothing written to its settings.
 */
const modeField = (setting: string, label: string, fallback: string, options: [string, string][]) => `
			<sdpi-item ${attr("label", label)}>
				<sdpi-select setting="${setting}" default="${fallback}">
					${options.map(([value, key]) => `<option value="${value}"${text(key)}</option>`).join("\n\t\t\t\t\t")}
				</sdpi-select>
			</sdpi-item>`;

/** Shows `id` only in `modes`; an unsaved mode is the page's `fallback`. */
const inModes = (setting: string, id: string, fallback: string, modes: string[]) =>
	showWhen(setting, id, `${JSON.stringify(modes)}.includes(value === "" ? "${fallback}" : value)`);

/** A dial's own strip background, style and text scroll, over the global ones in T3 Deck Settings. */
const dialAppearance = `
			<sdpi-item ${attr("label", "inspector.field.strip")}>
				<sdpi-select setting="background" default="">
					<option value=""${text("inspector.background.global")}</option>
					<option value="t3"${text("inspector.background.t3")}</option>
					<option value="flow"${text("inspector.background.flow")}</option>
					<option value="state"${text("inspector.background.state")}</option>
					<option value="custom"${text("inspector.background.custom")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.stripColor")} id="background-color" hidden>
				<sdpi-color setting="backgroundColor" default="#121212"></sdpi-color>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.style")}>
				<sdpi-select setting="stripStyle" default="">
					<option value=""${text("inspector.background.global")}</option>
					<option value="classic"${text("inspector.style.classic")}</option>
					<option value="list"${text("inspector.style.list")}</option>
					<option value="carousel"${text("inspector.style.carousel")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.longText")}>
				<sdpi-select setting="textScroll" default="">
					<option value=""${text("inspector.background.global")}</option>
					<option value="horizontal"${text("inspector.scroll.horizontal")}</option>
					<option value="vertical"${text("inspector.scroll.vertical")}</option>
					<option value="off"${text("inspector.scroll.off")}</option>
				</sdpi-select>
			</sdpi-item>`;
const dialAppearanceScript = showWhen("background", "background-color", `value === "custom"`);

/** Lookups, element helpers and the language swap both pages share; `afterStrings` re-renders runtime copy. */
const common = (afterStrings: string) => `
			const strings = ${JSON.stringify(cardStrings)};
			const s = (key, params = {}) => (strings[key] ?? key).replace(/\\{(\\w+)\\}/g, (match, name) => (name in params ? String(params[name]) : match));
			const $ = (id) => document.getElementById(id);
			const el = (tag, className, text) => {
				const node = document.createElement(tag);
				if (className) node.className = className;
				if (text !== undefined) node.textContent = text;
				return node;
			};
			${helpers}

			/** Swaps the English copy for the plugin's current-language table. */
			function applyStrings(table, lang) {
				if (lang) document.documentElement.lang = lang;
				Object.assign(strings, table);
				for (const node of document.querySelectorAll("[data-i18n]")) if (table[node.dataset.i18n]) node.textContent = table[node.dataset.i18n];
				for (const name of ["label", "placeholder", "loading", "aria-label"]) {
					for (const node of document.querySelectorAll("[data-i18n-" + name + "]")) {
						const value = table[node.getAttribute("data-i18n-" + name)];
						if (value) node.setAttribute(name, value);
					}
				}
				${afterStrings}
			}

			const STATE = {
				ready: (env) => (env.access === "Can act" ? ["ok", "inspector.card.connected"] : ["muted", "inspector.card.readOnly"]),
				connecting: () => ["muted", "inspector.card.connecting"],
				error: () => ["error", "inspector.card.tryAgain"],
				"signed-out": () => ["wait", "inspector.card.needsPairing"],
			};

			/** The pair link field and its Connect button, on whichever page holds them. */
			let pairedOnce = false;
			const syncPairButton = (working = false) => {
				$("t3-pair").disabled = working || !/[#?&]token=./.test($("t3-link").value);
				$("t3-pair").textContent = s(working ? "inspector.card.connecting" : "inspector.card.connect");
			};
			function renderPairing(pairing = { state: "idle" }) {
				const result = $("t3-result");
				result.hidden = pairing.state === "idle";
				result.classList.toggle("error", pairing.state === "error");
				result.textContent = pairing.state === "error" ? pairing.message : s("inspector.card.pairing");
				if (pairing.state === "idle" && pairedOnce) {
					$("t3-link").value = "";
					pairedOnce = false;
				}
				syncPairButton(pairing.state === "working");
			}
			function wirePairing(send) {
				$("t3-link").addEventListener("input", () => syncPairButton());
				$("t3-pair").addEventListener("click", () => {
					pairedOnce = true;
					send("pair", { link: $("t3-link").value.trim() });
					syncPairButton(true);
				});
				$("t3-link").addEventListener("keydown", (key) => {
					if (key.key === "Enter" && !$("t3-pair").disabled) $("t3-pair").click();
				});
			}`;

const script = (extra = "") => `
		<script>
			const client = SDPIComponents.streamDeckClient;
			const send = (event, extra) => client.send("sendToPlugin", { event, ...extra });${common(`for (const select of document.querySelectorAll("sdpi-select")) if (select.querySelector("option")) select.refresh?.();
				if (lastStatus) renderStatus(lastStatus);
				else syncPairButton();`)}

			const MARKS = { met: "✓", unmet: "✗", checking: "⋯" };
			const STATES = { met: "inspector.card.needsMet", unmet: "inspector.card.needsUnmet", checking: "inspector.card.needsChecking" };
			function renderNeeds(checklist) {
				const items = checklist?.items ?? [];
				const unmet = checklist?.unmet ?? 0;
				$("needs").hidden = items.length === 0;
				$("needs-count").className = unmet > 0 ? "count unmet" : "count";
				$("needs-count").textContent = unmet > 0 ? s("inspector.card.needsNotMet", { count: unmet }) : s("inspector.card.needsAllMet");
				$("needs-list").replaceChildren(...items.map((item) => {
					const row = el("li");
					row.dataset.state = item.state;
					const mark = el("span", "mark", MARKS[item.state] ?? "");
					mark.setAttribute("aria-hidden", "true");
					row.append(mark, el("span", "label", item.label));
					for (const fix of item.fixes ?? []) row.append(el("span", "fix", fix));
					row.setAttribute("aria-label", [item.label + ": " + s(STATES[item.state] ?? ""), ...(item.fixes ?? [])].join(". "));
					return row;
				}));
			}

			let lastStatus;
			function renderStatus(payload) {
				renderNeeds(payload.requirements);
				const environments = payload.environments ?? [];
				const selected = environments.some((env) => env.url === payload.selected) ? payload.selected : "";
				const ready = environments.filter((env) => env.state === "ready");

				// The machine this action follows: all of them, or one, each with its state in the option.
				const picker = $("t3-machine");
				const options = [];
				if (environments.length !== 1 || selected === "") {
					const all = el("option", "", s("inspector.card.allMachines") + " (" + (environments.length === 0 ? s("inspector.card.noneYet") : s("inspector.card.connectedCount", { ready: ready.length, total: environments.length })) + ")");
					all.value = "";
					options.push(all);
				}
				for (const env of environments) {
					const [, label] = (STATE[env.state] ?? STATE.connecting)(env);
					const option = el("option", "", env.name + " — " + s(label));
					option.value = env.url;
					options.push(option);
				}
				picker.replaceChildren(...options);
				picker.value = selected;
				picker.disabled = environments.length === 0;

				const summary = machineSummary(environments);
				$("t3-summary").className = "state " + summary.tone;
				$("t3-summary").textContent = s(summary.key, summary.params);

				$("t3-first").hidden = !needsFirstPairing(environments);
				$("t3-lede").textContent = s(environments.length === 0 ? "inspector.card.notRunning" : "inspector.card.howToPair");
				renderPairing(payload.pairing);
			}

			/**
			 * The settings window has no Stream Deck socket of its own: it reaches the plugin through this panel, its opener.
			 * Global settings are read fresh and merged on every write, one at a time, so neither a stale copy nor two quick
			 * changes can drop a machine, a token or each other.
			 */
			const listeners = new Set();
			const notify = (message) => {
				for (const listener of listeners) {
					try {
						listener(message);
					} catch {
						listeners.delete(listener);
					}
				}
			};
			let lang = "";
			let writes = Promise.resolve();
			window.t3Bridge = {
				send,
				s,
				strings,
				get lang() {
					return lang;
				},
				get status() {
					return lastStatus;
				},
				subscribe(listener) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
				getGlobalSettings: () => client.getGlobalSettings(),
				setGlobalSettings(patch) {
					writes = writes.catch(() => {}).then(async () => {
						const next = mergeGlobalSettings(await client.getGlobalSettings(), patch);
						await client.setGlobalSettings(next);
						notify({ event: "globals", settings: next });
						return next;
					});
					return writes;
				},
				openUrl: (url) => client.send("openUrl", { url }),
			};
			client.didReceiveGlobalSettings.subscribe(({ payload }) => notify({ event: "globals", settings: payload?.settings ?? {} }));

			client.sendToPropertyInspector.subscribe(({ payload }) => {
				if (payload?.event === "strings") {
					lang = payload.lang ?? lang;
					applyStrings(payload.strings ?? {}, payload.lang);
				}
				if (payload?.event === "status") {
					lastStatus = payload;
					renderStatus(payload);
				}
				notify(payload);
			});

			$("t3-open-settings").addEventListener("click", () => {
				const win = window.open("settings.html", "t3deck-settings", "width=760,height=640");
				$("t3-blocked").hidden = win !== null;
				win?.focus();
			});
			$("t3-machine").addEventListener("change", () => send("selectMachine", { url: $("t3-machine").value }));
			wirePairing(send);
			send("strings");
			send("status");${extra}
		</script>`;

const page = (title: string, fields = "", extra = "") => `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title>${title}</title>
		<script src="sdpi-components.js"></script>${style}${needsStyle}
	</head>
	<body>
		<main>${fields}${card}${needs}
		</main>${script(extra)}
	</body>
</html>
`;

/** A labeled row of the settings window, with an optional hint under its control. */
const field = (label: string, control: string, hint = "", id = "") => `
					<div class="field"${id ? ` id="${id}"` : ""}>
						<label${text(label)}</label>
						<div class="control">${control}</div>
					</div>${hint ? `\n\t\t\t\t\t<p class="hint"${text(hint)}</p>` : ""}`;

const select = (setting: string, options: [string, string][]) =>
	`<select class="native" data-setting="${setting}">${options.map(([value, key]) => `<option value="${value}"${text(key)}</option>`).join("")}</select>`;

/** What each language calls itself, so the list reads the same in every one. */
const languages = ["English", "Deutsch", "Español", "Français", "日本語", "한국어", "简体中文", "繁體中文"].map((name) => `<span class="nowrap">${name}</span>`).join(" · ");

const settingsPage = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<title${text("inspector.settings.title")}</title>
		<style>${baseStyle}
			html, body { height: 100%; }
			body { margin: 0; color: #d8d8d8; background: #262626; }
			.win { display: grid; grid-template-columns: 150px minmax(0, 1fr); height: 100%; }
			nav { display: grid; align-content: start; gap: 2px; padding: 14px 8px; background: #1f1f1f; border-right: 1px solid #333; }
			nav .title { padding: 0 8px 10px; color: #f0f0f0; font-size: 10pt; font-weight: 600; }
			nav button { padding: 6px 8px; font: inherit; text-align: left; color: #bdbdbd; background: none; border: 0; border-radius: 4px; cursor: pointer; }
			nav button:hover { color: #fff; }
			nav button[aria-current="page"] { color: #fff; background: #3a3a3a; }
			main { padding: 16px 20px; overflow: auto; }
			h1 { margin: 0 0 14px; color: #f0f0f0; font-size: 13pt; font-weight: 600; }
			h1 + .lede { margin-top: -12px; }
			h2 { margin: 18px 0 6px; color: #9a9a9a; font-size: 8.5pt; font-weight: 600; letter-spacing: .06em; text-transform: uppercase; }
			.lede { max-width: 460px; margin: 0 0 14px; color: #9a9a9a; line-height: 1.45; }
			.hint { max-width: 460px; margin: -4px 0 12px 150px; color: #9a9a9a; line-height: 1.45; }
			.hint.wide { margin: 6px 0 0; max-width: 520px; }
			.hint.error { color: #f87171; }
			.field { display: grid; grid-template-columns: 140px minmax(0, 320px); gap: 10px; align-items: center; margin: 0 0 8px; }
			.field > label { color: #bdbdbd; }
			.control { display: flex; align-items: center; gap: 6px; min-width: 0; }
			.check { display: flex; align-items: center; gap: 6px; }
			input[type="color"] { width: 48px; height: 24px; padding: 0 2px; background: #3d3d3d; border: 0; border-radius: 3px; }
			.rows { display: grid; gap: 6px; }
			.row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 10px; padding: 9px 10px; background: #303030; border-radius: 4px; }
			.row > * { min-width: 0; }
			.row .name { color: #f0f0f0; font-size: 9.5pt; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.row .where { color: #8f8f8f; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.row .state { font-size: 8.5pt; }
			.row .detail { grid-column: 1 / -1; color: #9a9a9a; line-height: 1.35; }
			.row .detail.error { color: #f87171; }
			.row .buttons { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
			.access { grid-column: 1 / -1; display: grid; gap: 3px; margin-top: 4px; padding-top: 6px; border-top: 1px solid #424242; }
			.access .heading { color: #9a9a9a; font-size: 8pt; letter-spacing: .06em; text-transform: uppercase; }
			.access .line { display: flex; justify-content: space-between; gap: 10px; }
			.access .line .scope { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
			.pair { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; max-width: 520px; }
			.detached { padding: 24px; color: #9a9a9a; }
			.nowrap { white-space: nowrap; }
		</style>
	</head>
	<body>
		<p class="detached" id="detached"${text("inspector.settings.detached")}</p>
		<div class="win" id="win" hidden>
			<nav>
				<div class="title">T3 Deck</div>
				<button type="button" data-section="machines"${text("inspector.card.machines")}</button>
				<button type="button" data-section="appearance"${text("inspector.settings.appearance")}</button>
				<button type="button" data-section="behavior"${text("inspector.settings.behavior")}</button>
				<button type="button" data-section="diagnostics"${text("inspector.diagnostics.title")}</button>
				<button type="button" data-section="about"${text("inspector.settings.about")}</button>
			</nav>
			<main>
				<section id="section-machines">
					<h1${text("inspector.card.machines")}</h1>
					<p class="lede"${text("inspector.settings.machinesLede")}</p>
					<div class="rows" id="t3-machines" aria-live="polite"></div>
					<h2${text("inspector.card.addMachine")}</h2>
					<div class="pair">
						<input class="native" id="t3-link" type="url" autocomplete="off" spellcheck="false" ${attr("placeholder", "inspector.card.linkPlaceholder")} />
						<button class="sd" id="t3-pair" type="button" disabled${text("inspector.card.connect")}</button>
						<button class="sd" id="t3-get-link" type="button"${text("inspector.card.getLink")}</button>
					</div>
					<p class="hint wide error" id="t3-result" hidden></p>
					<p class="hint wide"${text("inspector.card.accessHelp")}</p>
				</section>
				<section id="section-appearance" hidden>
					<h1${text("inspector.settings.appearance")}</h1>${field(
						"inspector.advanced.dialStrips",
						select("stripBackground", [
							["t3", "inspector.background.t3"],
							["flow", "inspector.background.flow"],
							["state", "inspector.background.state"],
							["custom", "inspector.background.custom"],
						]),
					)}${field("inspector.field.stripColor", `<input type="color" data-setting="stripColor" />`, "", "strip-color")}${field(
						"inspector.advanced.stateLine",
						`<label class="check"><input type="checkbox" data-setting="stripHairline" /><span${text("inspector.advanced.stateLineLabel")}</span></label>`,
						"inspector.advanced.stateHint",
					)}${field(
						"inspector.advanced.stripStyle",
						select("stripStyle", [
							["", "inspector.style.perDial"],
							["classic", "inspector.style.classic"],
							["list", "inspector.style.list"],
							["carousel", "inspector.style.carousel"],
						]),
					)}${field(
						"inspector.field.longText",
						select("textScroll", [
							["horizontal", "inspector.scroll.horizontal"],
							["vertical", "inspector.scroll.vertical"],
							["off", "inspector.scroll.off"],
						]),
						"inspector.advanced.styleHint",
					)}${field(
						"inspector.advanced.maxEffort",
						select("maxEffort", [
							["gradient", "inspector.maxEffort.gradient"],
							["solid", "inspector.maxEffort.solid"],
							["model", "inspector.maxEffort.model"],
							["off", "inspector.maxEffort.off"],
						]),
						"inspector.advanced.maxEffortHint",
					)}${field(
						"inspector.advanced.motion",
						select("motion", [
							["full", "inspector.motion.full"],
							["reduced", "inspector.motion.reduced"],
							["off", "inspector.motion.off"],
						]),
						"inspector.advanced.motionHint",
					)}${
						FEATURES.idlePet
							? field(
									"inspector.advanced.idlePet",
									`${select("idlePet", [
										["off", "inspector.idlePet.off"],
										["on", "inspector.idlePet.on"],
									])}<button class="sd" id="t3-preview-pet" type="button"${text("inspector.advanced.previewPet")}</button>`,
									"inspector.advanced.idlePetHint",
								)
							: ""
					}
				</section>
				<section id="section-behavior" hidden>
					<h1${text("inspector.settings.behavior")}</h1>${field(
						"inspector.advanced.confirm",
						select("confirmSend", [
							["review", "inspector.confirm.review"],
							["hold", "inspector.confirm.hold"],
							["off", "inspector.confirm.off"],
						]),
						"inspector.advanced.confirmHint",
					)}${field("inspector.advanced.appLink", `<input class="native" data-setting="scheme" type="text" spellcheck="false" placeholder="t3code" />`, "inspector.advanced.appLinkHint")}
				</section>
				<section id="section-diagnostics" hidden>
					<h1${text("inspector.diagnostics.title")}</h1>${field(
						"inspector.diagnostics.verbose",
						`<label class="check"><input type="checkbox" id="t3-verbose" /><span${text("inspector.diagnostics.verboseLabel")}</span></label>`,
					)}
					<p class="hint" id="t3-verbose-state"${text("inspector.card.verboseOff")}</p>${field(
						"inspector.diagnostics.logs",
						`<button class="sd" id="t3-open-logs" type="button"${text("inspector.diagnostics.openLogs")}</button>`,
					)}${field("inspector.diagnostics.report", `<button class="sd" id="t3-export" type="button"${text("inspector.diagnostics.export")}</button>`, "inspector.diagnostics.exportHint")}
					<p class="hint error" id="t3-diagnostics-result" hidden${text("inspector.card.diagnosticsFailed")}</p>
				</section>
				<section id="section-about" hidden>
					<h1${text("inspector.settings.about")}</h1>${field("inspector.settings.version", `<span>${manifest.Version}</span>`)}${field(
						"inspector.settings.languages",
						`<span>${languages}</span>`,
						"inspector.settings.languagesHint",
					)}${field("inspector.settings.readme", `<button class="sd" id="t3-readme" type="button"${text("inspector.settings.openReadme")}</button>`)}
				</section>
			</main>
		</div>
		<script>${common("if (lastStatus) renderStatus(lastStatus);\n\t\t\t\telse syncPairButton();")}

			const README = "https://github.com/alejandrom2/t3-deck#readme";

			/** Every bridge call goes through here: a closed or replaced opener detaches the window instead of failing. */
			let bridge;
			let unsubscribe;
			const call = (work) => {
				if (bridge === undefined) return undefined;
				try {
					return work(bridge);
				} catch {
					detach();
					return undefined;
				}
			};
			const send = (event, extra) => call((b) => b.send(event, extra));
			const write = (patch) => {
				Object.assign(globals, patch);
				renderGlobals(globals);
				call((b) => b.setGlobalSettings(patch));
			};

			const SCOPE_NAMES = {
				"providers:manage": "inspector.card.scopeProviders",
				"environment:maintain": "inspector.card.scopeMaintain",
				"terminal:operate": "inspector.card.scopeTerminal",
				"terminal:read": "inspector.card.scopeTerminalRead",
				"access:write": "inspector.card.scopeShare",
			};
			const button = (label, kind, event, url, extra = {}) => {
				const node = el("button", kind, label);
				node.type = "button";
				node.addEventListener("click", () => send(event, { url, ...extra }));
				return node;
			};
			/** Each opt-in scope on its own line: held by the pairing, or asked for at the next one, with a way to take that back. */
			function optIns(url, optIn) {
				const block = el("div", "access");
				block.append(el("div", "heading", s("inspector.card.optInTitle")));
				for (const { scope, state } of optIn) {
					const line = el("div", "line");
					line.append(el("span", "scope", SCOPE_NAMES[scope] ? s(SCOPE_NAMES[scope]) : scope));
					const right = el("span");
					right.append(el("span", state === "held" ? "state ok" : "state wait", s(state === "held" ? "inspector.card.optInHeld" : "inspector.card.optInPending")));
					if (state === "pending") right.append(" · ", button(s("inspector.card.optInDrop"), "text", "unflagScope", url, { scope }));
					line.append(right);
					block.append(line);
				}
				return block;
			}

			const focusLink = () => {
				$("t3-link").focus();
				$("t3-link").select();
			};

			/** One machine: name, address and state, what went wrong or how to pair, its extra access, then its buttons. */
			function row(env) {
				const node = el("div", "row");
				const text = el("div");
				text.append(el("div", "name", env.name), el("div", "where", env.where));
				const [tone, label] = (STATE[env.state] ?? STATE.connecting)(env);
				node.append(text, el("span", "state " + tone, s(label)));
				if (env.state === "error" && env.message) node.append(el("div", "detail error", env.message));
				if (env.state === "signed-out") node.append(el("div", "detail", env.message ?? s("inspector.card.pasteFromMachine")));
				if (env.optIn?.length) node.append(optIns(env.url, env.optIn));
				const buttons = el("div", "buttons");
				if (env.state === "ready") buttons.append(button(s("inspector.card.signOut"), "sd", "signOut", env.url));
				if (env.state === "error") buttons.append(button(s("inspector.card.tryAgain"), "sd", "retry", env.url));
				if (env.state === "signed-out") {
					buttons.append(button(s("inspector.card.getLinkRow"), "sd", "getPairLink", env.url));
					const paste = el("button", "sd", s("inspector.card.pasteLink"));
					paste.type = "button";
					paste.addEventListener("click", focusLink);
					buttons.append(paste);
				}
				if (!env.local) buttons.append(button(s("inspector.card.remove"), "sd", "remove", env.url));
				if (buttons.childElementCount > 0) node.append(buttons);
				return node;
			}

			let lastStatus;
			function renderStatus(payload) {
				lastStatus = payload;
				const environments = payload.environments ?? [];
				$("t3-machines").replaceChildren(...(environments.length === 0 ? [el("p", "hint wide", s("inspector.card.notRunning"))] : environments.map(row)));
				renderPairing(payload.pairing);
				const until = typeof payload.verboseUntil === "number" ? new Date(payload.verboseUntil) : undefined;
				$("t3-verbose").checked = until !== undefined;
				$("t3-verbose-state").textContent = until
					? s("inspector.card.verboseUntil", { time: until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }) })
					: s("inspector.card.verboseOff");
			}

			/** What Stream Deck's own fields showed for a setting never saved. */
			const DEFAULTS = { scheme: "", stripBackground: "t3", stripColor: "#121212", stripHairline: true, stripStyle: "", textScroll: "horizontal", motion: "full", idlePet: "off", confirmSend: "review", maxEffort: "gradient" };
			const globals = {};
			function renderGlobals(settings) {
				Object.assign(globals, settings);
				for (const control of document.querySelectorAll("[data-setting]")) {
					const value = globals[control.dataset.setting] ?? DEFAULTS[control.dataset.setting];
					if (control.type === "checkbox") control.checked = value !== false;
					else if (document.activeElement !== control) control.value = value;
				}
				$("strip-color").hidden = (globals.stripBackground ?? DEFAULTS.stripBackground) !== "custom";
			}
			for (const control of document.querySelectorAll("[data-setting]")) {
				control.addEventListener("change", () => {
					const patch = { [control.dataset.setting]: control.type === "checkbox" ? control.checked : control.value.trim() };
					// The plugin ignores a custom background with no color, so save the one the picker shows.
					if (patch.stripBackground === "custom" && !globals.stripColor) patch.stripColor = DEFAULTS.stripColor;
					write(patch);
				});
			}

			function onMessage(message) {
				if (message?.event === "strings") applyStrings(message.strings ?? {}, message.lang);
				if (message?.event === "status") renderStatus(message);
				if (message?.event === "globals") renderGlobals(message.settings ?? {});
				if (message?.event === "diagnostics") $("t3-diagnostics-result").hidden = message.ok === true;
			}

			function detach() {
				try {
					unsubscribe?.();
				} catch {}
				bridge = undefined;
				unsubscribe = undefined;
				$("win").hidden = true;
				$("detached").hidden = false;
			}

			/** Finds the opener's bridge: on load, and again whenever another action's panel takes the window over. */
			function attach() {
				let next;
				try {
					next = window.opener && !window.opener.closed ? window.opener.t3Bridge : undefined;
				} catch {}
				if (next === bridge) return;
				detach();
				if (next === undefined) return;
				bridge = next;
				try {
					applyStrings(bridge.strings, bridge.lang);
					unsubscribe = bridge.subscribe(onMessage);
					if (bridge.status) renderStatus(bridge.status);
					bridge.getGlobalSettings().then((settings) => renderGlobals(settings ?? {}), () => {});
					bridge.send("status");
				} catch {
					return detach();
				}
				$("win").hidden = false;
				$("detached").hidden = true;
			}

			function show(section) {
				if (!$("section-" + section)) section = "machines";
				for (const node of document.querySelectorAll("main > section")) node.hidden = node.id !== "section-" + section;
				for (const node of document.querySelectorAll("nav button")) {
					if (node.dataset.section === section) node.setAttribute("aria-current", "page");
					else node.removeAttribute("aria-current");
				}
			}
			for (const node of document.querySelectorAll("nav button")) node.addEventListener("click", () => show(node.dataset.section));
			show(location.hash.slice(1));

			$("t3-get-link").addEventListener("click", () => send("getPairLink", {}));
			$("t3-verbose").addEventListener("change", () => send("verbose", { on: $("t3-verbose").checked }));
			$("t3-open-logs").addEventListener("click", () => send("openLogs"));
			$("t3-export").addEventListener("click", () => send("exportDiagnostics"));
			$("t3-preview-pet")?.addEventListener("click", () => send("previewPet"));
			$("t3-readme").addEventListener("click", () => call((b) => b.openUrl(README)));
			wirePairing(send);
			renderGlobals({});

			attach();
			// Stream Deck may tear the panel down without an unload event; a cheap check notices the opener went away.
			setInterval(attach, 1000);
			window.addEventListener("focus", attach);
			window.addEventListener("pagehide", () => {
				try {
					unsubscribe?.();
				} catch {}
			});
		</script>
	</body>
</html>
`;

const filterOptions = `
				<sdpi-select setting="filter" default="all">
					<option value="all"${text("inspector.filter.all")}</option>
					<option value="attention"${text("inspector.filter.attention")}</option>
					<option value="active"${text("inspector.filter.active")}</option>
					<option value="unread"${text("inspector.filter.unread")}</option>
				</sdpi-select>`;

const authorityOptions = `
				<sdpi-select setting="approvalAuthority" default="open">
					<option value="open"${text("inspector.authority.open")}</option>
					<option value="once"${text("inspector.authority.once")}</option>
					<option value="session"${text("inspector.authority.session")}</option>
					<option value="always"${text("inspector.authority.always")}</option>
				</sdpi-select>`;

/** Hold or tap for git keys; by default only actions that push need a hold. */
const gitConfirm = `
			<sdpi-item ${attr("label", "inspector.git.confirm")}>
				<sdpi-select setting="confirm" default="">
					<option value=""${text("inspector.git.confirmDefault")}</option>
					<option value="tap"${text("inspector.git.tap")}</option>
					<option value="hold"${text("inspector.git.hold")}</option>
				</sdpi-select>
			</sdpi-item>`;

/** Send Prompt's panel, starting in `fallback`: the key's own text only for My text. */
const sendPage = (fallback: string) =>
	page(
		"Send Prompt",
		`${targetField}${modeField("template", "inspector.field.prompt", fallback, [
			["custom", "inspector.send.myText"],
			["continue", "inspector.quick.continue"],
			["test", "inspector.quick.test"],
			["fix", "inspector.quick.fix"],
			["explain", "inspector.quick.explain"],
			["commit", "inspector.quick.commit"],
		])}
			<sdpi-item ${attr("label", "inspector.send.text")} id="send-text" hidden>
				<sdpi-textarea setting="prompt" rows="4" ${attr("placeholder", "inspector.send.promptPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.send.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<p class="hint"${text("inspector.send.hint")}</p>${confirmField}`,
		inModes("template", "send-text", fallback, ["custom"]) + targetScript,
	);

/** Stop's panel, starting in `fallback`. */
const stopPage = (fallback: string) =>
	page(
		"Stop",
		`${targetField}${modeField("mode", "inspector.stop.stops", fallback, [
			["turn", "inspector.stop.turn"],
			["workflow", "inspector.stop.workflow"],
		])}
			<p class="hint" id="workflow-hint" hidden${text("inspector.workflow.hint")}</p>`,
		targetScript + inModes("mode", "workflow-hint", fallback, ["workflow"]),
	);

/** Fork's panel, starting in `fallback`, with each mode's hint. */
const forkPage = (fallback: string) =>
	page(
		"Fork",
		`${targetField}${modeField("mode", "inspector.field.does", fallback, [
			["fork", "inspector.lineage.fork"],
			["merge", "inspector.lineage.merge"],
		])}
			<p class="hint" id="fork-hint" hidden${text("inspector.lineage.forkHint")}</p>
			<p class="hint" id="merge-hint" hidden${text("inspector.lineage.mergeHint")}</p>`,
		targetScript + inModes("mode", "fork-hint", fallback, ["fork"]) + inModes("mode", "merge-hint", fallback, ["merge"]),
	);

/** Open's panel, starting in `fallback`: the editor picker for Editor, the Target for Preview. */
const openPage = (fallback: string) =>
	page(
		"Open",
		`${modeField("mode", "inspector.open.in", fallback, [
			["editor", "inspector.open.editor"],
			["preview", "inspector.open.preview"],
		])}
			<div id="open-editor" hidden>
				<sdpi-item ${attr("label", "inspector.editor.label")}>
					<sdpi-select setting="editor" datasource="getEditors" hot-reload ${attr("loading", "inspector.editor.loading")} default=""></sdpi-select>
				</sdpi-item>
				<p class="hint"${text("inspector.editor.hint")}</p>
			</div>
			<div id="open-preview" hidden>${targetField}
				<p class="hint"${text("inspector.preview.hint")}</p>
			</div>`,
		inModes("mode", "open-editor", fallback, ["editor"]) + inModes("mode", "open-preview", fallback, ["preview"]) + targetScript,
	);

/** Pull Request's panel, starting in `fallback`: Fix findings' hold and hint only for it. */
const prPage = (fallback: string) =>
	page(
		"Pull Request",
		`${modeField("mode", "inspector.field.does", fallback, [
			["show", "inspector.pr.show"],
			["fix", "inspector.pr.fix"],
			["explain", "inspector.pr.explain"],
			["ask", "inspector.pr.ask"],
			["guide", "inspector.pr.guide"],
		])}
			<div id="pr-fix" hidden>
				<sdpi-item ${attr("label", "inspector.pr.confirm")}>
					<sdpi-select setting="confirm" default="hold">
						<option value="hold"${text("inspector.pr.hold")}</option>
						<option value="tap"${text("inspector.pr.tap")}</option>
					</sdpi-select>
				</sdpi-item>
				<p class="hint"${text("inspector.pr.fixHint")}</p>
			</div>`,
		inModes("mode", "pr-fix", fallback, ["fix"]),
	);

/** Git's panel, starting in `fallback`: the message only for commits, and Pull's own hint. */
const gitPage = (fallback: string) =>
	page(
		"Git",
		`${modeField("gitAction", "inspector.git.action", fallback, [
			["commit", "inspector.git.commit"],
			["commit_push", "inspector.git.commitPush"],
			["commit_push_pr", "inspector.git.commitPushPr"],
			["push", "inspector.git.push"],
			["create_pr", "inspector.git.createPr"],
			["pull", "inspector.git.pull"],
		])}
			<sdpi-item ${attr("label", "inspector.git.message")} id="git-message" hidden>
				<sdpi-textfield setting="commitMessage" ${attr("placeholder", "inspector.git.messagePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title"></sdpi-textfield>
			</sdpi-item>${gitConfirm}
			<p class="hint" id="git-hint" hidden${text("inspector.git.hint")}</p>
			<p class="hint" id="git-pull-hint" hidden${text("inspector.git.pullHint")}</p>`,
		inModes("gitAction", "git-message", fallback, ["commit", "commit_push", "commit_push_pr"]) +
			inModes("gitAction", "git-hint", fallback, ["commit", "commit_push", "commit_push_pr", "push", "create_pr"]) +
			inModes("gitAction", "git-pull-hint", fallback, ["pull"]),
	);

/** What the Limits key and dial show, and what holding them does. */
const limitsFields = `
			<sdpi-item ${attr("label", "inspector.limits.show")}>
				<sdpi-select setting="show" default="left">
					<option value="left"${text("inspector.limits.left")}</option>
					<option value="used"${text("inspector.limits.used")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.limits.resetAction")}>
				<sdpi-select setting="resetAction" default="open">
					<option value="open"${text("inspector.limits.open")}</option>
					<option value="spend"${text("inspector.limits.spend")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint" id="spend-hint" hidden${text("inspector.limits.spendHint")}</p>`;
const limitsScript = showWhen("resetAction", "spend-hint", `value === "spend"`);

/** T3 Code's Usage periods; its page opens on 30 days. */
const periodField = `
			<sdpi-item ${attr("label", "inspector.usage.period")}>
				<sdpi-select setting="period" default="30">
					<option value="1"${text("inspector.usage.day")}</option>
					<option value="7"${text("inspector.usage.week")}</option>
					<option value="30"${text("inspector.usage.month")}</option>
					<option value="90"${text("inspector.usage.quarter")}</option>
				</sdpi-select>
			</sdpi-item>`;

const usageProviderField = `
			<sdpi-item ${attr("label", "inspector.usage.provider")}>
				<sdpi-select setting="provider" datasource="getUsageProviders" hot-reload ${attr("loading", "inspector.loading.providers")} default=""></sdpi-select>
			</sdpi-item>`;

/** Which thread the action acts on: the selection, or one thread picked from the machine's threads. */
const targetField = `
			<sdpi-item ${attr("label", "inspector.target.label")}>
				<sdpi-select setting="target" default="selected">
					<option value="selected"${text("inspector.target.selected")}</option>
					<option value="thread"${text("inspector.target.thread")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.target.pick")} id="target-thread" hidden>
				<sdpi-select setting="thread" datasource="getThreads" hot-reload ${attr("loading", "inspector.loading.threads")}></sdpi-select>
			</sdpi-item>
			<p class="hint" id="target-hint" hidden${text("inspector.target.hint")}</p>`;
const targetScript = showWhen("target", "target-thread", `value === "thread"`) + showWhen("target", "target-hint", `value === "thread"`);

const pages: Record<string, string> = {
	"environments.html": page("T3 Deck"),
	"slot.html": page(
		"Thread",
		`
			<sdpi-item ${attr("label", "inspector.slot.label")}>
				<sdpi-select setting="slot" default="">
					<option value=""${text("inspector.slot.byPosition")}</option>
					<option value="0"${text("inspector.slot.selected")}</option>
					${Array.from({ length: 12 }, (_, i) => (i === 0 ? `<option value="1"${text("inspector.slot.first")}</option>` : `<option value="${i + 1}">${i + 1}</option>`)).join("\n\t\t\t\t\t")}
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.slot.hint")}</p>`,
	),
	"activity.html": page(
		"Activity",
		`
			<sdpi-item ${attr("label", "inspector.field.show")}>${filterOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.project")}>
				<sdpi-select setting="project" datasource="getProjects" hot-reload ${attr("loading", "inspector.loading.projects")} default=""></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.activity.hint")}</p>`,
	),
	"answer.html": page(
		"Answer Dial",
		`
			<sdpi-item ${attr("label", "inspector.field.approvals")}>${authorityOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.toAnswer")}>
				<sdpi-select setting="approvalConfirm" default="hold">
					<option value="hold"${text("inspector.answer.hold")}</option>
					<option value="tap"${text("inspector.answer.press")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.answer.hint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"send.html": sendPage("custom"),
	"quick.html": sendPage("continue"),
	"steer.html": page(
		"Steer",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.steer.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.prompt")}>
				<sdpi-textarea setting="prompt" rows="4" ${attr("placeholder", "inspector.steer.promptPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<p class="hint"${text("inspector.steer.hint")}</p>${confirmField}`,
		targetScript,
	),
	"new.html": page(
		"New Thread",
		`
			<sdpi-item ${attr("label", "inspector.new.createIn")}>
				<sdpi-select setting="destination" default="selected">
					<option value="selected"${text("inspector.new.selected")}</option>
					<option value="scratch"${text("inspector.new.scratch")}</option>
					<option value="project"${text("inspector.new.project")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.project")} id="project" hidden>
				<sdpi-select setting="project" datasource="getLaunchProjects" hot-reload ${attr("loading", "inspector.loading.projects")}></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.new.startIn")}>
				<sdpi-select setting="startIn" default="folder">
					<option value="folder"${text("inspector.new.folder")}</option>
					<option value="worktree"${text("inspector.new.worktree")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint" id="worktree-hint" hidden${text("inspector.new.worktreeHint")}</p>
			<sdpi-item ${attr("label", "inspector.field.prompt")}>
				<sdpi-textarea setting="prompt" rows="4" ${attr("placeholder", "inspector.new.promptPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.new.title")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.new.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<p class="hint"${text("inspector.new.hint")}</p>`,
		showWhen("destination", "project", `value === "project"`) + showWhen("startIn", "worktree-hint", `value === "worktree"`),
	),
	"model.html": page(
		"Model",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.model")}>
				<sdpi-select setting="model" datasource="getModels" hot-reload ${attr("loading", "inspector.loading.models")} default=""></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.model.nameColor")}>
				<sdpi-select setting="nameColor" default="model">
					<option value="model"${text("inspector.model.nameModel")}</option>
					<option value="white"${text("inspector.model.nameWhite")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.model.hint")}</p>`,
		targetScript,
	),
	"effort.html": page(
		"Effort",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.effort")}>
				<sdpi-select setting="effort" datasource="getEfforts" hot-reload ${attr("loading", "inspector.loading.efforts")} default=""></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.effort.hint")}</p>`,
		targetScript,
	),
	"permissions.html": page(
		"Permissions",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.access")}>
				<sdpi-select setting="mode" default="">
					<option value=""${text("inspector.permissions.cycle")}</option>
					<option value="approval-required"${text("inspector.permissions.approvalRequired")}</option>
					<option value="auto-accept-edits"${text("inspector.permissions.autoAcceptEdits")}</option>
					<option value="auto"${text("inspector.permissions.auto")}</option>
					<option value="full-access"${text("inspector.permissions.fullAccess")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.permissions.hint")}</p>`,
		targetScript,
	),
	"approve.html": page(
		"Approve",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.field.approvals")}>${authorityOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.toAnswer")}>
				<sdpi-select setting="approvalConfirm" default="hold">
					<option value="hold"${text("inspector.approve.hold")}</option>
					<option value="tap"${text("inspector.approve.tap")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.approve.hint")}</p>`,
		targetScript,
	),
	"speed.html": page("Speed", targetField, targetScript),
	"target.html": page("Target", targetField, targetScript),
	"organize.html": page(
		"Organize",
		`
			<div id="organize-target">${targetField}
			</div>
			<sdpi-item ${attr("label", "inspector.organize.action")}>
				<sdpi-select setting="organize" default="settle">
					<option value="settle"${text("inspector.organize.settle")}</option>
					<option value="pin"${text("inspector.organize.pin")}</option>
					<option value="snooze"${text("inspector.organize.snooze")}</option>
					<option value="archive"${text("inspector.organize.archive")}</option>
					<option value="mark_unread"${text("inspector.organize.markUnread")}</option>
					<option value="wake"${text("inspector.organize.wake")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.organize.snoozeFor")} id="snooze-for">
				<sdpi-select setting="snoozeMinutes" default="60">
					<option value="15"${text("inspector.organize.minutes15")}</option>
					<option value="30"${text("inspector.organize.minutes30")}</option>
					<option value="60"${text("inspector.organize.hour1")}</option>
					<option value="120"${text("inspector.organize.hours2")}</option>
					<option value="240"${text("inspector.organize.hours4")}</option>
					<option value="480"${text("inspector.organize.hours8")}</option>
					<option value="1440"${text("inspector.organize.day1")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.organize.confirm")} id="confirm-first">
				<sdpi-select setting="confirm" default="review">
					<option value="review"${text("inspector.organize.confirmReview")}</option>
					<option value="hold"${text("inspector.organize.confirmHold")}</option>
					<option value="off"${text("inspector.organize.confirmOff")}</option>
				</sdpi-select>
			</sdpi-item>`,
		showWhen("organize", "snooze-for", `value === "snooze"`) + showWhen("organize", "confirm-first", `value === "" || value === "settle" || value === "snooze"`) +
			showWhen("organize", "organize-target", `value !== "wake"`) +
			targetScript,
	),
	"task.html": page(
		"Run Task",
		`
			<sdpi-item ${attr("label", "inspector.task.label")}>
				<sdpi-select setting="task" datasource="getTasks" hot-reload ${attr("loading", "inspector.loading.tasks")}></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.task.hint")}</p>`,
	),
	"skill.html": page(
		"Run Skill",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.skill.label")}>
				<sdpi-select setting="skill" datasource="getSkills" hot-reload ${attr("loading", "inspector.loading.skills")}></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.skill.extra")}>
				<sdpi-textarea setting="prompt" rows="3" ${attr("placeholder", "inspector.skill.extraPlaceholder")}></sdpi-textarea>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.keyTitle")}>
				<sdpi-textfield setting="title" ${attr("placeholder", "inspector.skill.titlePlaceholder")}></sdpi-textfield>
			</sdpi-item>
			<p class="hint"${text("inspector.skill.hint")}</p>${confirmField}`,
		targetScript,
	),
	"skills-dial.html": page(
		"Skills Dial",
		`${targetField}
			<p class="hint"${text("inspector.skill.dialHint")}</p>${confirmField}${dialAppearance}`,
		targetScript + dialAppearanceScript,
	),
	"stop.html": stopPage("turn"),
	"workflow.html": stopPage("workflow"),
	"fork.html": forkPage("fork"),
	"merge.html": forkPage("merge"),
	"tasks-dial.html": page(
		"Tasks Dial",
		`
			<p class="hint"${text("inspector.task.dialHint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"queue-dial.html": page(
		"Queue Dial",
		`
			<p class="hint"${text("inspector.queue.hint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"prompts.html": page(
		"Prompts Dial",
		`
			<sdpi-item ${attr("label", "inspector.prompts.label")}>
				<sdpi-textarea setting="prompts" rows="6" ${attr("placeholder", "inspector.prompts.placeholder")}></sdpi-textarea>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.prompts.templates")}>
				<sdpi-checkbox setting="templates" default="true" ${attr("label", "inspector.prompts.templatesLabel")}></sdpi-checkbox>
			</sdpi-item>
			<p class="hint"${text("inspector.prompts.hint")}</p>${confirmField}${dialAppearance}`,
		dialAppearanceScript,
	),
	"threads-dial.html": page(
		"Threads Dial",
		`
			<sdpi-item ${attr("label", "inspector.field.show")}>${filterOptions}
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.field.project")}>
				<sdpi-select setting="project" datasource="getProjects" hot-reload ${attr("loading", "inspector.loading.projects")} default=""></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.threads.recency")}>
				<sdpi-select setting="recency" default="all">
					<option value="all"${text("inspector.threads.noLimit")}</option>
					<option value="24h"${text("inspector.threads.day")}</option>
					<option value="48h"${text("inspector.threads.twoDays")}</option>
					<option value="3d"${text("inspector.threads.threeDays")}</option>
					<option value="7d"${text("inspector.threads.week")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.threads.hint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"power.html": page(
		"Power Dial",
		`
			<sdpi-item ${attr("label", "inspector.power.controls")}>
				<sdpi-select setting="dialControls" default="model">
					<option value="model"${text("inspector.field.model")}</option>
					<option value="effort"${text("inspector.field.effort")}</option>
					<option value="permissions"${text("inspector.field.access")}</option>
				</sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.power.bottomRow")} id="model-row">
				<sdpi-checkbox setting="showSpeed" default="true" ${attr("label", "inspector.power.showSpeed")}></sdpi-checkbox>
				<sdpi-checkbox setting="showEffort" default="true" ${attr("label", "inspector.power.showEffort")}></sdpi-checkbox>
			</sdpi-item>
			<p class="hint"${text("inspector.power.hint")}</p>${dialAppearance}`,
		dialAppearanceScript + showWhen("dialControls", "model-row", `value === "" || value === "model"`),
	),
	"git.html": gitPage("commit"),
	"git-push.html": gitPage("push"),
	"git-pr.html": gitPage("create_pr"),
	"git-pull.html": gitPage("pull"),
	"pr.html": prPage("show"),
	"pr-fix.html": prPage("fix"),
	"pr-explain.html": prPage("explain"),
	"pr-ask.html": prPage("ask"),
	"pr-guide.html": prPage("guide"),
	"pr-dial.html": page(
		"PR Dial",
		`
			<sdpi-item ${attr("label", "inspector.pr.confirm")}>
				<sdpi-select setting="confirm" default="hold">
					<option value="hold"${text("inspector.pr.hold")}</option>
					<option value="tap"${text("inspector.pr.tap")}</option>
				</sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.pr.dialHint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"limits.html": page(
		"Limits",
		`
			<sdpi-item ${attr("label", "inspector.limits.provider")}>
				<sdpi-select setting="provider" datasource="getLimitProviders" hot-reload ${attr("loading", "inspector.loading.providers")} default=""></sdpi-select>
			</sdpi-item>
			<sdpi-item ${attr("label", "inspector.limits.window")}>
				<sdpi-select setting="window" datasource="getLimitWindows" hot-reload ${attr("loading", "inspector.loading.windows")} default=""></sdpi-select>
			</sdpi-item>${limitsFields}
			<p class="hint"${text("inspector.limits.hint")}</p>`,
		limitsScript,
	),
	"limits-dial.html": page(
		"Limits Dial",
		`${limitsFields}
			<p class="hint"${text("inspector.limits.hint")}</p>${dialAppearance}`,
		dialAppearanceScript + limitsScript,
	),
	"usage.html": page(
		"Usage",
		`${periodField}${usageProviderField}
			<p class="hint"${text("inspector.usage.hint")}</p>`,
	),
	"usage-dial.html": page(
		"Usage Dial",
		`${periodField}${usageProviderField}
			<p class="hint"${text("inspector.usage.dialHint")}</p>${dialAppearance}`,
		dialAppearanceScript,
	),
	"devices-dial.html": page(
		"Devices Dial",
		`${targetField}
			<p class="hint"${text("inspector.devices.hint")}</p>${dialAppearance}`,
		targetScript + dialAppearanceScript,
	),
	"open.html": openPage("editor"),
	"preview.html": openPage("preview"),
	"update.html": page(
		"Update T3",
		`
			<p class="hint"${text("inspector.update.hint")}</p>
			<p class="hint access"${text("inspector.update.access")}</p>`,
	),
	"script.html": page(
		"Run Script",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.script.label")}>
				<sdpi-select setting="script" datasource="getScripts" hot-reload ${attr("loading", "inspector.loading.scripts")}></sdpi-select>
			</sdpi-item>
			<p class="hint"${text("inspector.script.hint")}</p>
			<p class="hint access"${text("inspector.script.access")}</p>`,
		targetScript,
	),
	"share.html": page(
		"Share Thread",
		`${targetField}
			<sdpi-item ${attr("label", "inspector.share.link")} id="share-link" hidden>
				<input class="link" id="share-url" type="text" readonly spellcheck="false" />
			</sdpi-item>
			<p class="hint" id="share-link-hint" hidden${text("inspector.share.linkHint")}</p>
			<p class="hint"${text("inspector.share.hint")}</p>
			<p class="hint access"${text("inspector.share.access")}</p>`,
		`${targetScript}
			{
				// The link is a credential: it lives only in this page and the running plugin, never in settings.
				const showLink = (url) => {
					$("share-url").value = url ?? "";
					$("share-link").hidden = !url;
					$("share-link-hint").hidden = !url;
				};
				$("share-url").addEventListener("focus", () => $("share-url").select());
				client.sendToPropertyInspector.subscribe(({ payload }) => {
					if (payload?.event === "shareLink") showLink(payload.url);
				});
				client.didReceiveSettings.subscribe(() => send("getShareLink"));
				send("getShareLink");
			}`,
	),
};

for (const [name, html] of Object.entries(pages)) writeFileSync(join(dir, name), html);
writeFileSync(join(dir, "settings.html"), settingsPage);
