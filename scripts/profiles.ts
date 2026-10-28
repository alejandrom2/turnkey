// Builds the bundled Stream Deck profiles into the plugin: `node scripts/profiles.ts`.
// Format follows Stream Deck 7.5+ exports: package.json beside Profiles/<id>.sdProfile, zipped.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { type GlyphName, renderControlKey } from "../src/core/render.ts";

const root = join(import.meta.dirname, "..");
const pluginDir = join(root, "com.alejandrom2.turnkey.sdPlugin");
const manifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8")) as { UUID: string; Name: string; Version: string };

/** Stable ids keep regenerated profiles diff-free. */
const uuid = (seed: string) => {
	const hex = createHash("sha256").update(`turnkey:${seed}`).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

/** A key, or with `folder` a Stream Deck folder key that opens that page. */
type Placed = { action: string; name: string; settings?: Record<string, string>; folder?: Page; glyph?: GlyphName };

const state = { FontFamily: "", FontSize: 12, FontStyle: "", FontUnderline: false, OutlineThickness: 2, ShowTitle: false, TitleAlignment: "bottom", TitleColor: "#ffffff" };

const entry = (seed: string, placed: Placed) => ({
	ActionID: uuid(seed),
	LinkedTitle: false,
	Name: placed.name,
	Plugin: { Name: manifest.Name, UUID: manifest.UUID, Version: manifest.Version },
	Resources: null,
	Settings: placed.settings ?? {},
	State: 0,
	States: [state],
	UUID: `${manifest.UUID}.${placed.action}`,
});

/** Without a number a Thread key fills by its position; the second page continues the board from slot 5. */
const slot = (n?: number): Placed => ({ action: "slot", name: "Thread", ...(n === undefined ? {} : { settings: { slot: String(n) } }) });

const power = (control: string): Placed => ({ action: "dial.model", name: "Power Dial", settings: { dialControls: control } });

const DIALS: Placed[] = [
	{ action: "dial.threads", name: "Threads Dial", settings: { filter: "attention" } },
	power("model"),
	{ action: "dial.prompts", name: "Prompts Dial", settings: { prompts: ["Review your changes for bugs", "Summarize what you changed"].join("\n") } },
	{ action: "dial.answer", name: "Answer Dial" },
];

const limits = (provider: string, window: string): Placed => ({ action: "limits", name: "Limits", settings: { provider, window } });
const usage = (period: string): Placed => ({ action: "usage", name: "Usage", settings: { period } });

/** Run Skill keys start unpicked: skills come from each thread's provider and checkout. */
const skill = (): Placed => ({ action: "skill", name: "Run Skill" });

/** Run Script keys start unpicked, so the bundled profile never asks a machine for terminal access by itself. */
const script = (): Placed => ({ action: "script", name: "Run Script" });

/** Run Task keys start unpicked: tasks are the user's own. */
const task = (): Placed => ({ action: "task", name: "Run Task" });

/** Send Prompt with one of its everyday templates. */
const quick = (template: string): Placed => ({ action: "send", name: "Send Prompt", settings: { template } });
const organize = (which: string): Placed => ({ action: "organize", name: "Organize", settings: { organize: which } });

const key = (action: string, name: string, settings?: Record<string, string>): Placed => ({ action, name, ...(settings ? { settings } : {}) });
const activity = key("activity", "Activity");
const newThread = key("new", "New Thread");
const sendContinue = key("send", "Send Prompt", { prompt: "Continue", title: "Continue" });
const steer = key("steer", "Steer", { title: "Keep it small", prompt: "Keep the change small and focused." });
const stop = key("stop", "Stop");
const stopWorkflow = key("stop", "Stop", { mode: "workflow" });
const approve = key("approve", "Approve");
const deny = key("deny", "Deny");
const model = key("model", "Model");
const effort = key("effort", "Effort");
const speed = key("speed", "Speed");
const health = key("health", "Health");
const editor = key("open", "Open");
const preview = key("open", "Open", { mode: "preview" });
const branch = key("branch", "Branch");
/** Git starts on Commit; other keys pick their action. */
const git = (gitAction?: string): Placed => key("git", "Git", gitAction ? { gitAction } : undefined);
const createPr = git("create_pr");
/** Pull Request starts on Show; other keys hand the pull request to an agent. */
const prKey = (mode: string): Placed => key("pr", "Pull Request", { mode });
const threadsDial = (filter: string): Placed => ({ action: "dial.threads", name: "Threads Dial", settings: { filter } });
const queueDial: Placed = { action: "dial.queue", name: "Queue Dial" };
const usageDial: Placed = { action: "dial.usage", name: "Usage Dial", settings: { period: "7" } };
const skillsDial: Placed = { action: "dial.skills", name: "Skills Dial" };
const prDial: Placed = { action: "dial.pr", name: "PR Dial" };

/**
 * Pages are lists in reading order, so one definition fits any keypad: a device takes them row by row. `dials`
 * replace the shared ones on a dial device; `infobar` is the Neo's info bar.
 */
type Page = { name: string; keys: Placed[]; dials?: Placed[]; infobar?: Placed };

/** A folder key drawn like a Turnkey key; its page opens with Stream Deck's Back key first, so it holds seven keys. */
const folder = (name: string, glyph: GlyphName, keys: Placed[], dials: Placed[], infobar?: Placed): Placed => ({
	action: "",
	name,
	glyph,
	folder: { name: name.toUpperCase(), keys, dials, infobar },
});

/** What the Neo's info bar shows inside a folder: its subject, from a bare instance of the action that has it. */
const bars = { model, queue: key("send", "Send Prompt"), git: git(), pr: key("pr", "Pull Request"), limits: key("limits", "Limits") };

/** Stream Deck + and Neo: the second page is a menu of folders, so any job is two presses from home. */
const MENU_8: Page = {
	name: "MENU",
	keys: [
		folder("Threads", "chat", [slot(1), slot(2), slot(3), slot(4), slot(5), slot(6), slot(7)], [threadsDial("all"), threadsDial("active"), threadsDial("unread"), DIALS[3]!]),
		folder("Controls", "sliders", [model, effort, speed, key("permissions", "Permissions"), key("plan", "Plan"), approve, deny], [power("model"), power("effort"), power("permissions"), DIALS[3]!], bars.model),
		folder("Prompts", "spark", [quick("test"), quick("fix"), quick("explain"), quick("commit"), organize("settle"), organize("pin"), organize("snooze")], [DIALS[0]!, DIALS[2]!, queueDial, DIALS[3]!], bars.queue),
		folder("Skills", "skill", [skill(), skill(), skill(), skill(), key("fork", "Fork"), key("fork", "Fork", { mode: "merge" }), stopWorkflow], [skillsDial, DIALS[0]!, queueDial, DIALS[3]!], bars.queue),
		folder("Git", "branch", [git(), git("push"), createPr, git("pull"), branch, editor, organize("archive")], [DIALS[0]!, prDial, power("model"), DIALS[3]!], bars.git),
		folder("Pull Requests", "pullRequest", [key("pr", "Pull Request"), prKey("fix"), prKey("explain"), prKey("ask"), prKey("guide"), createPr, editor], [prDial, DIALS[0]!, DIALS[2]!, DIALS[3]!], bars.pr),
		folder(
			"Usage",
			"usage",
			[limits("codex", "session"), limits("codex", "weekly"), limits("claudeAgent", "session"), limits("claudeAgent", "weekly"), usage("1"), usage("7"), usage("30")],
			[{ action: "dial.limits", name: "Limits Dial" }, usageDial, DIALS[0]!, DIALS[3]!],
			bars.limits,
		),
		folder("More", "device", [preview, task(), script(), key("update", "Update T3"), key("share", "Share Thread"), organize("wake"), health], [
			{ action: "dial.devices", name: "Devices Dial" },
			{ action: "dial.tasks", name: "Tasks Dial" },
			queueDial,
			DIALS[3]!,
		]),
	],
};

/** The everyday home page for Stream Deck + and Neo. */
const CURATED_8: Page = {
	name: "TURNKEY",
	keys: [activity, steer, speed, model, sendContinue, newThread, stop, effort],
	dials: [threadsDial("attention"), usageDial, power("model"), skillsDial],
};

/** 15 keys: a home page with everything a running turn needs. */
const HOME_15: Placed[] = [slot(), slot(), slot(), slot(), activity, newThread, sendContinue, steer, stop, approve, deny, model, effort, speed, health];

/** Pages for keypads without page buttons; `nav` keys take the bottom corners. */
const PAGES_15: Page[] = [
	{ name: "TURNKEY", keys: HOME_15.slice(0, 14) },
	{ name: "THREADS", keys: [slot(5), slot(6), slot(7), slot(8), slot(9), slot(10), slot(11), slot(12), slot(13), slot(14), organize("settle"), organize("pin"), organize("snooze")] },
	{
		name: "CONTROLS",
		keys: [key("permissions", "Permissions"), key("plan", "Plan"), quick("continue"), quick("test"), quick("fix"), quick("explain"), quick("commit"), stopWorkflow, key("fork", "Fork"), key("fork", "Fork", { mode: "merge" }), organize("wake"), organize("archive"), health],
	},
	{ name: "SKILLS", keys: [skill(), skill(), skill(), skill(), task(), task(), task(), task(), editor, preview, key("update", "Update T3"), key("share", "Share Thread"), stop] },
	{
		name: "GIT",
		keys: [git(), git("push"), createPr, git("pull"), branch, key("pr", "Pull Request"), prKey("fix"), prKey("explain"), prKey("ask"), prKey("guide"), editor, stop, health],
	},
	{ name: "USAGE", keys: [limits("codex", "session"), limits("codex", "weekly"), limits("claudeAgent", "session"), limits("claudeAgent", "weekly"), usage("1"), usage("7"), usage("30"), script(), script(), script(), health, stop, approve, deny] },
];

const XL_HOME: Placed[] = [
	...Array.from({ length: 8 }, () => slot()),
	activity,
	newThread,
	sendContinue,
	steer,
	stop,
	approve,
	deny,
	quick("continue"),
	model,
	effort,
	speed,
	key("permissions", "Permissions"),
	key("plan", "Plan"),
	health,
	editor,
	preview,
	git(),
	git("push"),
	createPr,
	git("pull"),
	branch,
	key("pr", "Pull Request"),
	usage("7"),
	limits("codex", "weekly"),
];

const XL_MORE: Placed[] = [
	slot(9),
	slot(10),
	slot(11),
	slot(12),
	slot(13),
	slot(14),
	slot(15),
	quick("test"),
	quick("fix"),
	quick("explain"),
	quick("commit"),
	organize("settle"),
	organize("pin"),
	organize("snooze"),
	organize("wake"),
	organize("archive"),
	skill(),
	skill(),
	task(),
	task(),
	key("fork", "Fork"),
	key("fork", "Fork", { mode: "merge" }),
	stopWorkflow,
	prKey("fix"),
	prKey("explain"),
	prKey("ask"),
	prKey("guide"),
	key("update", "Update T3"),
	script(),
	key("share", "Share Thread"),
	limits("claudeAgent", "weekly"),
];

type Device = {
	model: string;
	type: number;
	columns: number;
	rows: number;
	/** Stream Deck +: four dials under the keys. */
	dials?: boolean;
	/** Stream Deck Neo: the info bar between its page buttons. */
	infobar?: boolean;
	/** Keypads without page buttons get Stream Deck's own Previous and Next Page keys in the bottom corners. */
	nav?: boolean;
};

// Device models from Stream Deck's own default profiles.
const PLUS: Device = { model: "20GBD9901", type: 7, columns: 4, rows: 2, dials: true };
const NEO: Device = { model: "20GBJ9901", type: 9, columns: 4, rows: 2, infobar: true };
const MK2: Device = { model: "20GAA9902", type: 0, columns: 5, rows: 3, nav: true };
const XL: Device = { model: "20GAT9902", type: 2, columns: 8, rows: 4, nav: true };
const MINI: Device = { model: "20GAI9901", type: 1, columns: 3, rows: 2 };

/** `seed` keeps action and page ids stable when a file is renamed. */
type Profile = { file: string; seed: string; name: string; device: Device; pages: Page[] };

/** Three pages for the Mini's six keys, around Stream Deck's page keys. */
const PAGES_MINI: Page[] = [
	{ name: "TURNKEY", keys: [slot(), slot(), activity, approve, stop] },
	{ name: "CONTROLS", keys: [sendContinue, deny, model, effort] },
	{ name: "MORE", keys: [newThread, steer, git(), usage("7"), health] },
];

const NAME = "Turnkey";

/**
 * One profile per device: the everyday keys on its first page, then a page (or on Stream Deck + and Neo, a folder) per job. Every action in the actions list
 * (dials only on Stream Deck +) appears at least once on every device but the Mini, so the pages double as a tour of
 * what the deck can do. The seeds are the old everyday profiles', so an update replaces them.
 */
const PROFILES: Profile[] = [
	{ file: "turnkey-plus", seed: "turnkey-plus-curated", name: NAME, device: PLUS, pages: [CURATED_8, MENU_8] },
	{ file: "turnkey-neo", seed: "turnkey-neo", name: NAME, device: NEO, pages: [CURATED_8, MENU_8] },
	{ file: "turnkey-15", seed: "turnkey-15", name: NAME, device: MK2, pages: PAGES_15 },
	{ file: "turnkey-xl", seed: "turnkey-xl", name: NAME, device: XL, pages: [{ name: "TURNKEY", keys: XL_HOME.slice(0, 31) }, { name: "MORE", keys: XL_MORE }] },
	{ file: "turnkey-mini", seed: "turnkey-mini", name: NAME, device: { ...MINI, nav: true }, pages: PAGES_MINI },
];

const NAV = {
	previous: { uuid: "com.elgato.streamdeck.page.previous", name: "Previous Page" },
	next: { uuid: "com.elgato.streamdeck.page.next", name: "Next Page" },
	back: { uuid: "com.elgato.streamdeck.profile.backtoparent", name: "Parent Folder" },
} as const;

/** Stream Deck's own page or folder key: no plugin, no image of ours. */
const navEntry = (seed: string, which: keyof typeof NAV) => ({
	ActionID: uuid(seed),
	LinkedTitle: true,
	Name: NAV[which].name,
	Settings: {},
	State: 0,
	States: [{}],
	UUID: NAV[which].uuid,
});

const folderId = (seed: string, page: Page) => uuid(`${seed}:folder:${page.name}`);

/** A folder key's face, written into the Images folder of the page that holds it. */
const folderImage = (profileSeed: string, page: Page) => `Images/${folderId(profileSeed, page).toUpperCase()}.svg`;

const folderFace = (placed: Placed) =>
	Buffer.from(renderControlKey({ glyph: placed.glyph!, label: placed.name, shrink: placed.name.length > 8 }).split(",")[1]!, "base64").toString();

/** Stream Deck's folder key, opening the folder page written beside the profile's pages. The face carries the title. */
const folderEntry = (profileSeed: string, seed: string, placed: Placed) => ({
	ActionID: uuid(seed),
	LinkedTitle: true,
	Name: "Create Folder",
	Resources: null,
	Settings: { ProfileUUID: folderId(profileSeed, placed.folder!) },
	State: 0,
	States: [{ ...state, Image: folderImage(profileSeed, placed.folder!), Title: placed.name }],
	UUID: "com.elgato.streamdeck.profile.openchild",
});

/**
 * Lays a page's keys out row by row, around Previous (bottom left, after the first page), Next (bottom right, before
 * the last) and, in a folder, Back (top left).
 */
function keypad(profile: Profile, page: Page, at: { first: boolean; last: boolean; folder: boolean }): Record<string, unknown> {
	const { device, seed } = profile;
	const bottom = device.rows - 1;
	const reserved = new Map<string, keyof typeof NAV>();
	if (at.folder) reserved.set("0,0", "back");
	if (device.nav && !at.first) reserved.set(`0,${bottom}`, "previous");
	if (device.nav && !at.last) reserved.set(`${device.columns - 1},${bottom}`, "next");
	const actions: Record<string, unknown> = {};
	const queue = [...page.keys];
	for (let y = 0; y < device.rows; y++) {
		for (let x = 0; x < device.columns; x++) {
			const at = `${x},${y}`;
			const nav = reserved.get(at);
			if (nav !== undefined) actions[at] = navEntry(`${seed}:${page.name}:${nav}`, nav);
			else {
				const placed = queue.shift();
				const keySeed = `${seed}:${page.name}:key:${at}`;
				if (placed !== undefined) actions[at] = placed.folder ? folderEntry(seed, keySeed, placed) : entry(keySeed, placed);
			}
		}
	}
	if (queue.length > 0) throw new Error(`${profile.file}: page ${page.name} has ${queue.length} keys too many`);
	return actions;
}

function pageManifest(profile: Profile, page: Page | undefined, at = { first: true, last: true, folder: false }) {
	const { device, seed } = profile;
	const controllers: { Actions: Record<string, unknown> | null; Type: string }[] = [{ Actions: page === undefined ? null : keypad(profile, page, at), Type: "Keypad" }];
	if (device.dials) {
		const dials = Object.fromEntries((page?.dials ?? DIALS).map((placed, x) => [`${x},0`, entry(`${seed}:${page?.name}:dial:${x}`, placed)]));
		controllers.push({ Actions: page ? dials : null, Type: "Encoder" });
	}
	if (device.infobar) {
		const infobar = page && (page.infobar ?? activity);
		controllers.push({ Actions: infobar ? { "1,0": entry(`${seed}:${page.name}:infobar`, infobar) } : null, Type: "Neo" });
	}
	return { Controllers: controllers, Icon: "", Name: page?.name ?? "" };
}

for (const profile of PROFILES) {
	const staging = mkdtempSync(join(tmpdir(), "turnkey-profile-"));
	try {
		const profileId = uuid(`${profile.seed}:profile`).toUpperCase();
		const profileDir = join(staging, "Profiles", `${profileId}.sdProfile`);
		const pageIds = profile.pages.map((page) => uuid(`${profile.seed}:page:${page.name}`));
		const defaultId = uuid(`${profile.seed}:page:default`);

		const writeJson = (path: string, value: unknown) => {
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, JSON.stringify(value, null, "\t"));
		};
		writeJson(join(staging, "package.json"), {
			AppVersion: "7.5.0.22885",
			DeviceModel: profile.device.model,
			DeviceSettings: null,
			FormatVersion: 1,
			OSType: "macOS",
			OSVersion: "26.0",
			RequiredPlugins: [manifest.UUID],
		});
		writeJson(join(profileDir, "manifest.json"), {
			Device: { Model: profile.device.model, UUID: "" },
			Name: profile.name,
			Pages: { Current: pageIds[0], Default: defaultId, Pages: pageIds },
			Version: "3.0",
		});
		writeJson(join(profileDir, "Profiles", defaultId.toUpperCase(), "manifest.json"), pageManifest(profile, undefined));
		const last = profile.pages.length - 1;
		profile.pages.forEach((page, index) => {
			const pageDir = join(profileDir, "Profiles", pageIds[index]!.toUpperCase());
			writeJson(join(pageDir, "manifest.json"), pageManifest(profile, page, { first: index === 0, last: index === last, folder: false }));
			// Folder pages sit beside the pages but aren't listed in them: only their folder key opens them.
			for (const placed of page.keys) {
				if (!placed.folder) continue;
				writeJson(join(profileDir, "Profiles", folderId(profile.seed, placed.folder).toUpperCase(), "manifest.json"), pageManifest(profile, placed.folder, { first: true, last: true, folder: true }));
				mkdirSync(join(pageDir, "Images"), { recursive: true });
				writeFileSync(join(pageDir, folderImage(profile.seed, placed.folder)), folderFace(placed));
			}
		});

		const output = join(pluginDir, "profiles", `${profile.file}.streamDeckProfile`);
		mkdirSync(join(output, ".."), { recursive: true });
		rmSync(output, { force: true });
		// A fixed time, sorted entries and UTC (zip stores local time) keep a rebuilt zip byte-identical on every platform.
		const stamp = new Date("2026-01-01T00:00:00Z");
		const entries: string[] = [];
		const add = (entry: string) => {
			const path = join(staging, entry);
			utimesSync(path, stamp, stamp);
			entries.push(entry);
			if (statSync(path).isDirectory()) for (const name of readdirSync(path).sort()) add(join(entry, name));
		};
		add("package.json");
		add("Profiles");
		execFileSync("/usr/bin/zip", ["-X", "-q", output, ...entries], { cwd: staging, env: { ...process.env, TZ: "UTC" } });
		console.log(`wrote ${output}`);
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
