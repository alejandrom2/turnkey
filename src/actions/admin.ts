import streamDeck, { type Action, action, type DidReceiveSettingsEvent, type KeyUpEvent, type SendToPluginEvent, type WillDisappearEvent } from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import type { DeckThread } from "../core/board.js";
import { t } from "../core/i18n.js";
import { spinAngle } from "../core/motion.js";
import { COLORS, type GlyphName, renderInfoKey, renderNoticeKey } from "../core/render.js";
import type { Need } from "../core/requirements.js";
import { grants, needsAccessLabel } from "../core/scopes.js";
import { projectScripts, type ProjectScript, scriptBusy, scriptGlyph, scriptLaunch, scriptState, type ScriptState, scriptTerminalId, START_GRACE_MS, terminalKey } from "../core/scripts.js";
import { copyText, type GuestShare, shareFailure, ShareStore, shareView, type ShareView } from "../core/share.js";
import { pinnedName } from "../core/target.js";
import type { Machine } from "../core/t3/machine.js";
import { ACCESS_SCOPE, isThisComputer, MAINTAIN_SCOPE, type OptInScope, TERMINAL_READ_SCOPE, TERMINAL_SCOPE } from "../core/t3/pairing.js";
import { RpcError } from "../core/t3/rpc.js";
import { fetchUpdateTarget, RESTART_TIMEOUT_MS, updateFailure, updateRoute, type UpdateStage } from "../core/update.js";
import { deck } from "../deck.js";
import { connectionFace, DeckAction, errorMessage, held, machineName, pressWhileDisconnected, sendChoices } from "./base.js";
import { connectionOf, threadNeeds } from "./needs.js";
import { DeckWatch } from "./watch.js";

/**
 * Keys that need access a standard pairing doesn't ask for: updating T3 Code, running scripts in its terminals, and
 * sharing threads with guests. Each asks for it only on the machine it acts on, once the user presses it there (or
 * picks a script); that machine's next pairing then requests it.
 */
const ID = "com.alejandrom2.turnkey";
const logger = streamDeck.logger.createScope("admin");


/** Flags what `machine` lacks of `scopes` for its next pairing; true when it holds them all. */
async function ensureScopes(machine: Machine, scopes: readonly OptInScope[]): Promise<boolean> {
	const lacking = scopes.filter((scope) => !grants(machine.scopes, scope));
	if (lacking.length > 0) await deck.optInScope(machine.url, ...lacking);
	return lacking.length === 0;
}

/** The machine lacks `scopes` and its next pairing asks for them: the key says to pair again. */
const awaitingPairing = (machine: Machine, scopes: readonly OptInScope[]): boolean => scopes.some((scope) => !grants(machine.scopes, scope) && deck.scopeRequested(machine.url, scope));

const accessFace = (glyph: GlyphName, title: string) => renderNoticeKey({ glyph, title, detail: t("access.rePair"), tone: "attention" });

/** A spinner while Motion allows one, else a still mark. */
function busyGlyph(still: GlyphName): { glyph: GlyphName; spin?: number; moving: boolean } {
	const mode = deck.animator.mode;
	return mode === "off" ? { glyph: still, moving: false } : { glyph: "spinner", spin: spinAngle(mode, Date.now()), moving: true };
}

const scopeNeeds = (machine: Machine | undefined, scopes: readonly OptInScope[]): Need[] =>
	machine === undefined ? [] : scopes.map((scope): Need => ({ kind: "scope", scope, ok: grants(machine.scopes, scope) }));

type UpdateSettings = { machine?: string };

const STAGE_TITLE: Record<UpdateStage, Parameters<typeof t>[0]> = {
	checking: "update.checking",
	downloading: "update.downloading",
	installing: "update.installing",
	restarting: "update.restarting",
};

/** One update in flight per machine; `target` once known. `restarting` waits for the machine to come back on it. */
type UpdateRun = { stage: UpdateStage; target?: string; deadline?: number };

/**
 * T3 Code's version on one machine. Holding it updates T3 Code there to the newest release on its channel, as its
 * Update action does; the key shows the stages, then the new version once the server is back.
 */
@action({ UUID: `${ID}.update` })
export class UpdateKey extends DeckAction<UpdateSettings> {
	readonly #runs = new Map<string, UpdateRun>();
	#watch: ReturnType<typeof setInterval> | undefined;
	/** Its run's stages show through a restart, and it may follow this computer rather than its Machine setting. */
	protected override readonly showsConnection = false;

	constructor() {
		super();
		deck.onRepaint(() => this.#settle());
	}

	/** The picked machine, else T3 Code on this computer, else the only machine there is. */
	#machine(action: Action<UpdateSettings>): Machine | undefined {
		const url = this.machineOf(action);
		const machines = deck.machines;
		if (url !== undefined) return machines.find((machine) => machine.url === url);
		return machines.find((machine) => isThisComputer(new URL(machine.url).hostname)) ?? (machines.length === 1 ? machines[0] : undefined);
	}

	protected override async draw(action: Action<UpdateSettings>): Promise<void> {
		if (!action.isKey()) return;
		const machine = this.#machine(action);
		const run = machine && this.#runs.get(machine.url);
		if (run !== undefined) {
			const busy = busyGlyph("update");
			this.animate(action, busy.moving);
			const detail = run.target ? t("update.toVersion", { version: run.target }) : machineName(machine!);
			return void (await this.setImage(action, renderInfoKey({ glyph: busy.glyph, spin: busy.spin, title: t(STAGE_TITLE[run.stage]), detail })));
		}
		this.animate(action, false);
		if (machine === undefined) return void (await this.setImage(action, connectionFace(this.machineOf(action)) ?? renderInfoKey({ glyph: "update", title: t("update.title"), detail: t("update.pickMachine"), available: false })));
		const offline = connectionFace(machine.url);
		if (offline) return void (await this.setImage(action, offline));
		if (awaitingPairing(machine, [MAINTAIN_SCOPE])) return void (await this.setImage(action, accessFace("update", t("update.needsAccess"))));
		const environment = machine.updateEnvironment;
		const route = updateRoute(environment);
		const version = environment?.serverVersion;
		await this.setImage(
			action,
			renderInfoKey({
				glyph: "update",
				title: version ? t("update.version", { version }) : t("update.noVersion"),
				detail: route.kind === "manual" ? t(route.reason) : machineName(machine),
				available: route.kind !== "manual",
			}),
		);
	}

	override async onKeyUp(ev: KeyUpEvent<UpdateSettings>): Promise<void> {
		const heldMs = this.heldFor(ev.action.id);
		const machine = this.#machine(ev.action);
		if (await pressWhileDisconnected(machine?.url ?? this.machineOf(ev.action))) return;
		if (machine === undefined) return void (await this.flash(ev.action, false, t("update.pickMachine")));
		if (this.#runs.has(machine.url)) return;
		if (!(await ensureScopes(machine, [MAINTAIN_SCOPE]))) return void (await this.flash(ev.action, false, needsAccessLabel(MAINTAIN_SCOPE)));
		const route = updateRoute(machine.updateEnvironment);
		if (route.kind === "manual") return void (await this.flash(ev.action, false, t(route.reason)));
		if (!held(heldMs)) return void (await this.flash(ev.action, false, t("update.holdToUpdate")));
		await this.#update(machine);
	}

	async #update(machine: Machine): Promise<void> {
		const route = updateRoute(machine.updateEnvironment);
		const current = machine.updateEnvironment?.serverVersion;
		const set = (run: UpdateRun | undefined) => {
			if (run === undefined) this.#runs.delete(machine.url);
			else this.#runs.set(machine.url, run);
			this.#paintFor(machine.url);
		};
		set({ stage: "checking" });
		try {
			// The desktop app finds its own release; T3 Code's clients send their version, which it ignores.
			const target = route.kind === "desktop" ? undefined : current === undefined ? undefined : await fetchUpdateTarget(fetch, current);
			if (route.kind !== "desktop" && target === undefined) {
				set(undefined);
				return this.#flashFor(machine.url, t("update.upToDate"));
			}
			set({ stage: "downloading", target });
			const landing = await machine.updateServer(target ?? current ?? "0.0.0", (stage) => set({ stage, target }));
			set({ stage: "restarting", target: landing, deadline: Date.now() + RESTART_TIMEOUT_MS });
			this.#syncWatch();
		} catch (error) {
			logger.warn(`Updating T3 Code failed: ${errorMessage(error)}${error instanceof RpcError && error.code ? ` (${error.code})` : ""}`);
			set(undefined);
			const label = error instanceof RpcError && error.tag === "ServerSelfUpdateError" ? updateFailure(error.code) : error instanceof RpcError && error.reason ? error.reason : updateFailure(undefined);
			await this.#flashFor(machine.url, label);
		}
	}

	/** A restart ends once the machine is back on the new version, or fails when it isn't in time. */
	#settle(): void {
		for (const [url, run] of this.#runs) {
			if (run.stage !== "restarting") continue;
			const machine = deck.machines.find((candidate) => candidate.url === url);
			if (machine?.state.kind === "ready" && machine.updateEnvironment?.serverVersion === run.target) {
				this.#runs.delete(url);
				this.#paintFor(url);
			} else if (Date.now() > (run.deadline ?? 0)) {
				this.#runs.delete(url);
				void this.#flashFor(url, t("update.noReturn"));
			}
		}
		this.#syncWatch();
	}

	/** While a server restarts, look for it every few seconds instead of waiting out the reconnect backoff. */
	#syncWatch(): void {
		const restarting = [...this.#runs.values()].some((run) => run.stage === "restarting");
		if (!restarting) {
			clearInterval(this.#watch);
			this.#watch = undefined;
			return;
		}
		this.#watch ??= setInterval(() => {
			for (const [url, run] of this.#runs) {
				if (run.stage !== "restarting") continue;
				const machine = deck.machines.find((candidate) => candidate.url === url);
				if (machine?.state.kind !== "ready") machine?.wake();
			}
			this.#settle();
		}, 5_000);
	}

	#instancesFor(url: string) {
		return this.actions.filter((instance) => this.#machine(instance as Action<UpdateSettings>)?.url === url);
	}

	#paintFor(url: string): void {
		for (const instance of this.#instancesFor(url)) void this.paint(instance as Action<UpdateSettings>);
	}

	async #flashFor(url: string, label: string): Promise<void> {
		await Promise.all(this.#instancesFor(url).map((instance) => this.flash(instance as Action<UpdateSettings>, false, label)));
	}

	override needs(action: Action<UpdateSettings>): Need[] {
		const machine = this.#machine(action);
		const route = updateRoute(machine?.updateEnvironment);
		return [
			{ kind: "paired", connection: connectionOf(machine?.url ?? this.machineOf(action)) },
			...scopeNeeds(machine, [MAINTAIN_SCOPE]),
			...(machine?.state.kind === "ready" ? [{ kind: "selfUpdate", ok: route.kind !== "manual", reason: route.kind === "manual" ? t(route.reason) : undefined } satisfies Need] : []),
		];
	}
}

type ScriptSettings = { machine?: string; target?: string; thread?: string; threadTitle?: string; script?: string; scriptName?: string };

const SCRIPT_SCOPES = [TERMINAL_SCOPE, TERMINAL_READ_SCOPE] as const;

/** When the deck last started or stopped each script's terminal, by thread key and terminal id. */
const scriptRuns = new Map<string, { startedAt?: number; stoppedAt?: number }>();

/** The terminal states of the machines visible Run Script keys run on stay live. */
const terminals = new DeckWatch({ open: (machine) => machine.watchTerminals() });

const SCRIPT_DETAIL: Record<Exclude<ScriptState["kind"], "exited">, Parameters<typeof t>[0]> = {
	idle: "script.idle",
	starting: "script.starting",
	running: "script.running",
	finished: "script.finished",
	stopped: "script.stopped",
	error: "script.error",
};

/**
 * One of the project's saved scripts (T3 Code's actions), run in the target thread's terminal: in its worktree, else
 * the project's folder. Press runs it; while it runs, hold stops it. Needs terminal access: shell access there.
 */
@action({ UUID: `${ID}.script` })
export class RunScriptKey extends DeckAction<ScriptSettings> {
	readonly #grace = new Map<string, ReturnType<typeof setTimeout>>();
	protected override readonly watcher = terminals;

	protected override watched(action: Action<ScriptSettings>): readonly Machine[] {
		const { thread, script } = this.#state(action);
		return thread !== undefined && script !== undefined ? [thread.machine] : [];
	}

	#state(action: Action<ScriptSettings>) {
		const settings = this.settingsOf(action);
		const target = this.target(action);
		const thread = target.thread;
		const project = thread?.machine.project(thread.projectId);
		const scripts = thread && project ? projectScripts(thread.machine.scriptSettings, project) : [];
		const script = scripts.find((candidate) => candidate.id === settings.script);
		if (script !== undefined && script.name !== settings.scriptName) this.remember(action, { scriptName: script.name });
		const name = script?.name ?? settings.scriptName ?? settings.script ?? "";
		const reason =
			target.gone ??
			(thread === undefined
				? t("reason.noThread")
				: !settings.script
					? t("script.pick")
					: project === undefined
						? t("reason.noProject")
						: script === undefined
							? t("needs.notAvailable", { value: name })
							: undefined);
		return { thread, project, script, scripts, name, reason, pinned: target.pinned };
	}

	#run(thread: DeckThread, script: ProjectScript) {
		const terminalId = scriptTerminalId(script.id);
		const key = `${thread.key}\n${terminalId}`;
		const local = scriptRuns.get(key) ?? {};
		const state = scriptState(thread.machine.terminals?.get(terminalKey(thread.threadId, terminalId)), local, Date.now());
		return { terminalId, key, local, state };
	}

	protected override async draw(action: Action<ScriptSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { thread, script, name, reason, pinned } = this.#state(action);
		const title = name || t("script.title");
		if (reason !== undefined || thread === undefined || script === undefined) {
			this.animate(action, false);
			return void (await this.setImage(action, renderInfoKey({ glyph: scriptGlyph(script?.icon), title, detail: reason, available: false, pinned })));
		}
		if (awaitingPairing(thread.machine, SCRIPT_SCOPES)) {
			this.animate(action, false);
			return void (await this.setImage(action, accessFace("terminal", t("script.needsAccess"))));
		}
		const { state, local } = this.#run(thread, script);
		const busy = scriptBusy(state) ? busyGlyph(scriptGlyph(script.icon)) : undefined;
		this.animate(action, busy?.moving === true);
		if (state.kind === "starting") this.#recheck(action, (local.startedAt ?? 0) + START_GRACE_MS - Date.now());
		const color = state.kind === "exited" ? (state.code === 0 ? COLORS.done : COLORS.error) : state.kind === "error" ? COLORS.error : state.kind === "stopped" ? COLORS.muted : undefined;
		const detail = state.kind === "exited" ? (state.code === null ? t("script.ended") : t("script.exited", { code: state.code })) : t(SCRIPT_DETAIL[state.kind]);
		await this.setImage(action, renderInfoKey({ glyph: busy?.glyph ?? scriptGlyph(script.icon), spin: busy?.spin, color, title, detail, pinned }));
	}

	/** A start's grace period ends without an event when Motion is off: paint once more then. */
	#recheck(action: Action<ScriptSettings>, wait: number): void {
		if (this.#grace.has(action.id)) return;
		this.#grace.set(
			action.id,
			setTimeout(() => {
				this.#grace.delete(action.id);
				void this.paint(action);
			}, Math.max(0, wait) + 50),
		);
	}

	override onWillDisappear(ev: WillDisappearEvent<ScriptSettings>): void {
		clearTimeout(this.#grace.get(ev.action.id));
		this.#grace.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<ScriptSettings>): Promise<void> {
		const before = this.settingsOf(ev.action).script;
		super.onDidReceiveSettings(ev);
		// Picking a script is the user turning it on: its machine's next pairing asks for terminal access. Only on a
		// new pick, so Don't ask in the machine card sticks.
		const { thread, script } = this.#state(ev.action);
		if (thread !== undefined && script !== undefined && script.id !== before) await ensureScopes(thread.machine, SCRIPT_SCOPES);
		if (streamDeck.ui.action?.id === ev.action.id) await this.#sendScripts(ev.action);
	}

	override async onKeyUp(ev: KeyUpEvent<ScriptSettings>): Promise<void> {
		const heldMs = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		// Scripts come from the server config, which nothing keeps live here: a script added since needs a fresh read.
		const before = this.#state(ev.action);
		if (before.thread !== undefined && before.script === undefined) await deck.refreshConfigs(before.thread.machine.url);
		const { thread, project, script, reason } = this.#state(ev.action);
		if (reason !== undefined || thread === undefined || project === undefined || script === undefined) return void (await this.flash(ev.action, false, reason ?? t("failure.failed")));
		const machine = thread.machine;
		if (!(await ensureScopes(machine, SCRIPT_SCOPES))) return void (await this.flash(ev.action, false, needsAccessLabel(TERMINAL_SCOPE)));
		const { terminalId, key, local, state } = this.#run(thread, script);
		if (scriptBusy(state)) {
			if (!held(heldMs)) return void (await this.flash(ev.action, false, t("script.holdToStop")));
			return this.run(ev.action, async () => {
				await machine.interruptScript(thread.threadId, terminalId);
				scriptRuns.set(key, { ...local, stoppedAt: Date.now() });
			});
		}
		await this.run(ev.action, async () => {
			scriptRuns.set(key, { ...local, startedAt: Date.now() });
			try {
				await machine.runScript(thread.threadId, terminalId, scriptLaunch(project.workspaceRoot, thread.worktreePath), script.command);
			} catch (error) {
				scriptRuns.set(key, local);
				throw error;
			}
		});
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, ScriptSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== "getScripts") return super.onSendToPlugin(ev);
		await this.#sendScripts(ev.action);
	}

	/** The Script setting's choices: the target thread's project scripts, and a saved one that is gone. */
	async #sendScripts(action: Action<ScriptSettings>): Promise<void> {
		const thread = this.#state(action).thread;
		if (thread !== undefined) await deck.refreshConfigs(thread.machine.url);
		const { scripts } = this.#state(action);
		const settings = this.settingsOf(action);
		const items = [{ label: t("datasource.chooseScript"), value: "" }, ...scripts.map((script) => ({ label: script.name, value: script.id }))];
		await sendChoices("getScripts", items, settings.script, (saved) => t("needs.notAvailable", { value: settings.scriptName ?? saved }));
	}

	override needs(action: Action<ScriptSettings>): Need[] {
		const settings = this.settingsOf(action);
		const { thread, script, name, pinned } = this.#state(action);
		return [
			...threadNeeds(this.machineOf(action), thread, false, pinned ? pinnedName(settings) : undefined),
			settings.script && thread ? { kind: "value", value: name, ok: script !== undefined } : { kind: "script", ok: false },
			...scopeNeeds(thread?.machine, SCRIPT_SCOPES),
		];
	}
}

type ShareSettings = { machine?: string; target?: string; thread?: string; threadTitle?: string };

/** Shares of the threads visible Share keys show. */
const shares = new ShareStore(() => deck.repaint());

/** Links the deck made, by thread key: T3 Code shows a link once, so only these can be copied again. Never persisted. */
const links = new Map<string, { shareId: string | undefined; url: string }>();

/**
 * Makes a guest link for the target thread and copies it, as T3 Code's Share with guest does; a shared thread shows
 * "Shared", its guest and waiting messages. Hold stops sharing.
 */
@action({ UUID: `${ID}.share` })
export class ShareKey extends DeckAction<ShareSettings> {
	readonly #expiry = new Map<string, ReturnType<typeof setTimeout>>();

	#state(action: Action<ShareSettings>): { thread: DeckThread | undefined; share: GuestShare | null | undefined; view: ShareView | undefined; reason: string | undefined; pinned: boolean } {
		const target = this.target(action);
		const thread = target.thread;
		// A running thread's row moves with every event; its share is read again when its runs move instead.
		const share = thread && shares.of({ key: thread.key, stamp: thread.active ? thread.runStamp : String(thread.updatedAt) }, () => thread.machine.guestShare(thread));
		const view = share === undefined ? undefined : shareView(share, Date.now());
		const reason = target.gone ?? (thread === undefined ? t("reason.noThread") : view?.kind === "none" && !thread.machine.guestLinksEnabled ? t("share.disabled") : undefined);
		return { thread, share, view, reason, pinned: target.pinned };
	}

	protected override async draw(action: Action<ShareSettings>): Promise<void> {
		if (!action.isKey()) return;
		const { thread, share, view, reason, pinned } = this.#state(action);
		this.#expireAt(action, view?.kind === "active" ? share?.expiresAt : undefined);
		const title = thread?.title ?? t("share.title");
		if (reason !== undefined || thread === undefined) return void (await this.setImage(action, renderInfoKey({ glyph: "share", title: t("share.title"), detail: reason, available: false, pinned })));
		if (view === undefined || view.kind === "none") {
			if (view !== undefined && awaitingPairing(thread.machine, [ACCESS_SCOPE])) return void (await this.setImage(action, accessFace("share", t("share.needsAccess"))));
			return void (await this.setImage(action, renderInfoKey({ glyph: "share", title: t("share.title"), detail: title, available: view !== undefined, pinned })));
		}
		if (view.kind === "expired") return void (await this.setImage(action, renderInfoKey({ glyph: "guest", color: COLORS.muted, title: t("share.expired"), detail: t("share.holdToClear"), pinned })));
		const detail = view.pending > 0 ? (view.pending === 1 ? t("share.pendingOne") : t("share.pending", { count: view.pending })) : view.guest !== null ? t("share.guest", { name: view.guest }) : t("share.unused");
		await this.setImage(action, renderInfoKey({ glyph: "guest", color: view.pending > 0 ? COLORS.attention : COLORS.done, tint: view.pending > 0 ? COLORS.attention : undefined, title: t("share.shared"), detail, pinned }));
	}

	/** An active link turns to "expired" on its own: repaint then, while the key shows. */
	#expireAt(action: Action<ShareSettings>, expiresAt: string | undefined): void {
		clearTimeout(this.#expiry.get(action.id));
		this.#expiry.delete(action.id);
		const wait = expiresAt === undefined ? Number.NaN : Date.parse(expiresAt) - Date.now();
		if (!(wait > 0) || wait > 2 ** 31 - 1) return;
		this.#expiry.set(
			action.id,
			setTimeout(() => void this.paint(action), wait + 50),
		);
	}

	override onWillDisappear(ev: WillDisappearEvent<ShareSettings>): void {
		clearTimeout(this.#expiry.get(ev.action.id));
		this.#expiry.delete(ev.action.id);
		super.onWillDisappear(ev);
	}

	override async onKeyUp(ev: KeyUpEvent<ShareSettings>): Promise<void> {
		const heldMs = this.heldFor(ev.action.id);
		if (await pressWhileDisconnected(this.machineOf(ev.action))) return;
		// Guest links may have been turned on in Labs since the config was read; nothing keeps it live here.
		const before = this.#state(ev.action);
		if (before.thread !== undefined && !before.thread.machine.guestLinksEnabled) await deck.refreshConfigs(before.thread.machine.url);
		const { thread, share, view, reason } = this.#state(ev.action);
		if (reason !== undefined || thread === undefined) return void (await this.flash(ev.action, false, reason ?? t("failure.failed")));
		if (view === undefined) return;
		if (view.kind !== "none") {
			if (held(heldMs)) return this.#close(ev.action, thread);
			const link = links.get(thread.key);
			if (view.kind === "active" && link !== undefined && link.shareId === share?.id) return this.run(ev.action, () => copied(link.url));
			return void (await this.flash(ev.action, false, t(view.kind === "expired" ? "share.holdToClear" : "share.holdToStop")));
		}
		if (!(await ensureScopes(thread.machine, [ACCESS_SCOPE]))) return void (await this.flash(ev.action, false, needsAccessLabel(ACCESS_SCOPE)));
		await this.run(ev.action, async () => {
			let created: Awaited<ReturnType<Machine["createGuestLink"]>>;
			try {
				created = await thread.machine.createGuestLink(thread);
			} catch (error) {
				const reason = error instanceof RpcError ? shareFailure(error.code) : undefined;
				throw reason === undefined ? error : new RpcError((error as RpcError).tag, (error as RpcError).message, reason);
			}
			links.set(thread.key, { shareId: created.share?.id, url: created.url });
			shares.set(thread.key, created.share);
			await this.#sendLink(ev.action);
			await copied(created.url);
		});
	}

	async #close(action: Action<ShareSettings>, thread: DeckThread): Promise<void> {
		await this.run(action, async () => {
			await thread.machine.closeGuestLink(thread);
			links.delete(thread.key);
			shares.set(thread.key, null);
			await this.#sendLink(action);
		});
	}

	override async onSendToPlugin(ev: SendToPluginEvent<JsonValue, ShareSettings>): Promise<void> {
		const payload = ev.payload as { event?: string } | null;
		if (payload?.event !== "getShareLink") return super.onSendToPlugin(ev);
		await this.#sendLink(ev.action);
	}

	/** The link this deck made for the target thread, to the open inspector only: it is a credential. */
	async #sendLink(action: Action<ShareSettings>): Promise<void> {
		if (streamDeck.ui.action?.id !== action.id) return;
		const thread = this.target(action).thread;
		const link = thread && links.get(thread.key);
		await streamDeck.ui.sendToPropertyInspector({ event: "shareLink", url: link?.url ?? "" });
	}

	override needs(action: Action<ShareSettings>): Need[] {
		const settings = this.settingsOf(action);
		const { thread, pinned } = this.#state(action);
		return [
			...threadNeeds(this.machineOf(action), thread, true, pinned ? pinnedName(settings) : undefined),
			...(thread === undefined ? [] : [{ kind: "guestLinks", ok: thread.machine.guestLinksEnabled } satisfies Need]),
			...scopeNeeds(thread?.machine, [ACCESS_SCOPE]),
		];
	}
}

/** Copies a link; a failed copy still leaves it in the inspector. */
async function copied(url: string): Promise<void> {
	try {
		await copyText(url);
	} catch (error) {
		logger.warn(`Copying the guest link failed: ${errorMessage(error)}`);
		throw new RpcError("Copy", "Copying failed.", t("share.copyFailed"));
	}
}
