// Builds the bundled Stream Deck profiles into the plugin: `node scripts/profiles.ts`.
// Format follows Stream Deck 7.5+ exports: package.json beside Profiles/<id>.sdProfile, zipped.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const pluginDir = join(root, "com.alejandrom2.t3deck.sdPlugin");
const manifest = JSON.parse(readFileSync(join(pluginDir, "manifest.json"), "utf8")) as { UUID: string; Name: string; Version: string };

/** Stable ids keep regenerated profiles diff-free. */
const uuid = (seed: string) => {
	const hex = createHash("sha256").update(`t3-deck:${seed}`).digest("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};

type Placed = { action: string; name: string; settings?: Record<string, string> };

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

const DIALS: Placed[] = [
	{ action: "dial.threads", name: "Threads Dial" },
	{ action: "dial.model", name: "Model Dial" },
	{
		action: "dial.prompts",
		name: "Prompts Dial",
		settings: { prompts: ["Continue", "Run the tests and fix what fails", "Review your changes for bugs", "Summarize what you changed"].join("\n") },
	},
	{ action: "dial.answer", name: "Answer Dial" },
];

type Page = { name: string; keys: Placed[][] };

type Profile = { file: string; name: string; deviceModel: string; deviceType: number; columns: number; pages: Page[]; dials: boolean };

const PROFILES: Profile[] = [
	{
		file: "t3-deck-plus",
		name: "T3 Deck",
		deviceModel: "20GBD9901",
		deviceType: 7,
		columns: 4,
		dials: true,
		pages: [
			{
				name: "T3 DECK",
				keys: [
					[slot(), slot(), slot(), slot()],
					[
						{ action: "activity", name: "Activity" },
						{ action: "stop", name: "Stop" },
						{ action: "send", name: "Send Prompt", settings: { prompt: "Continue", title: "Continue" } },
						{ action: "approve", name: "Approve" },
					],
				],
			},
			{
				name: "THREADS",
				keys: [
					[slot(5), slot(6), slot(7), slot(8)],
					[slot(9), slot(10), slot(11), slot(12)],
				],
			},
			{
				name: "CONTROLS",
				keys: [
					[
						{ action: "model", name: "Model" },
						{ action: "effort", name: "Effort" },
						{ action: "speed", name: "Speed" },
						{ action: "permissions", name: "Permissions" },
					],
					[
						{ action: "plan", name: "Plan" },
						{ action: "steer", name: "Steer", settings: { title: "Keep it small", prompt: "Keep the change small and focused." } },
						{ action: "deny", name: "Deny" },
						{ action: "health", name: "Health" },
					],
				],
			},
		],
	},
];

function pageManifest(profile: Profile, page: Page | undefined) {
	const keys = Object.fromEntries(
		(page?.keys ?? []).flatMap((row, y) => row.map((placed, x) => [`${x},${y}`, entry(`${profile.file}:${page!.name}:key:${x},${y}`, placed)])),
	);
	const controllers: { Actions: Record<string, unknown> | null; Type: string }[] = [{ Actions: page ? keys : null, Type: "Keypad" }];
	if (profile.dials) {
		const dials = Object.fromEntries(DIALS.map((placed, x) => [`${x},0`, entry(`${profile.file}:${page?.name}:dial:${x}`, placed)]));
		controllers.push({ Actions: page ? dials : null, Type: "Encoder" });
	}
	return { Controllers: controllers, Icon: "", Name: page?.name ?? "" };
}

for (const profile of PROFILES) {
	const staging = mkdtempSync(join(tmpdir(), "t3-deck-profile-"));
	try {
		const profileId = uuid(`${profile.file}:profile`).toUpperCase();
		const profileDir = join(staging, "Profiles", `${profileId}.sdProfile`);
		const pageIds = profile.pages.map((page) => uuid(`${profile.file}:page:${page.name}`));
		const defaultId = uuid(`${profile.file}:page:default`);

		const writeJson = (path: string, value: unknown) => {
			mkdirSync(join(path, ".."), { recursive: true });
			writeFileSync(path, JSON.stringify(value, null, "\t"));
		};
		writeJson(join(staging, "package.json"), {
			AppVersion: "7.5.0.22885",
			DeviceModel: profile.deviceModel,
			DeviceSettings: null,
			FormatVersion: 1,
			OSType: "macOS",
			OSVersion: "26.0",
			RequiredPlugins: [manifest.UUID],
		});
		writeJson(join(profileDir, "manifest.json"), {
			Device: { Model: profile.deviceModel, UUID: "" },
			Name: profile.name,
			Pages: { Current: pageIds[0], Default: defaultId, Pages: pageIds },
			Version: "3.0",
		});
		writeJson(join(profileDir, "Profiles", defaultId.toUpperCase(), "manifest.json"), pageManifest(profile, undefined));
		profile.pages.forEach((page, index) => writeJson(join(profileDir, "Profiles", pageIds[index].toUpperCase(), "manifest.json"), pageManifest(profile, page)));

		const output = join(pluginDir, "profiles", `${profile.file}.streamDeckProfile`);
		mkdirSync(join(output, ".."), { recursive: true });
		rmSync(output, { force: true });
		execFileSync("/usr/bin/zip", ["-X", "-q", "-r", output, "package.json", "Profiles"], { cwd: staging });
		console.log(`wrote ${output}`);
	} finally {
		rmSync(staging, { recursive: true, force: true });
	}
}
