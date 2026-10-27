/** T3 Code's editor catalog (packages/contracts/src/editor.ts): ids it may report as available, and their names. */
export const EDITORS = [
	{ id: "cursor", label: "Cursor" },
	{ id: "trae", label: "Trae" },
	{ id: "kiro", label: "Kiro" },
	{ id: "vscode", label: "VS Code" },
	{ id: "vscode-insiders", label: "VS Code Insiders" },
	{ id: "vscodium", label: "VSCodium" },
	{ id: "zed", label: "Zed" },
	{ id: "antigravity", label: "Antigravity" },
	{ id: "idea", label: "IntelliJ IDEA" },
	{ id: "aqua", label: "Aqua" },
	{ id: "clion", label: "CLion" },
	{ id: "datagrip", label: "DataGrip" },
	{ id: "dataspell", label: "DataSpell" },
	{ id: "goland", label: "GoLand" },
	{ id: "phpstorm", label: "PhpStorm" },
	{ id: "pycharm", label: "PyCharm" },
	{ id: "rider", label: "Rider" },
	{ id: "rubymine", label: "RubyMine" },
	{ id: "rustrover", label: "RustRover" },
	{ id: "webstorm", label: "WebStorm" },
	{ id: "file-manager", label: "File Manager" },
] as const;

export type EditorId = (typeof EDITORS)[number]["id"];

export const editorLabel = (id: string): string => EDITORS.find((editor) => editor.id === id)?.label ?? id;

/** The editors a machine reported that this deck knows, in T3 Code's order. */
export const knownEditors = (available: readonly string[]): EditorId[] => EDITORS.filter((editor) => available.includes(editor.id)).map((editor) => editor.id);

/**
 * The editor a press opens: the key's choice, or T3 Code's default, its first available editor. T3 Code also
 * remembers the last editor picked per browser, which the deck can't see. Undefined when none is available.
 */
export function pickEditor(setting: unknown, available: readonly string[]): { editor: EditorId; missing?: undefined } | { editor?: undefined; missing: string } | undefined {
	const known = knownEditors(available);
	if (typeof setting === "string" && setting !== "") {
		const chosen = known.find((id) => id === setting);
		return chosen === undefined ? { missing: editorLabel(setting) } : { editor: chosen };
	}
	const first = known[0];
	return first === undefined ? undefined : { editor: first };
}

/** `shell.openInEditor`'s payload: the folder to open and the editor, launched on the machine T3 Code runs on. */
export const openInEditorInput = (cwd: string, editor: EditorId): { cwd: string; editor: EditorId } => ({ cwd, editor });
