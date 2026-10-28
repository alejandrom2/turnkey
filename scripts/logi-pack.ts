// Builds the Logitech plugin and packs it: `npm run logi:pack` writes logi/dist/Turnkey_<version>.lplug4.
// Needs the .NET SDK and LogiPluginTool (`dotnet tool install --global LogiPluginTool`); on macOS with Homebrew's .NET, set DOTNET_ROOT.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
const project = join(root, "logi", "TurnkeyPlugin");
const release = join(project, "bin", "Release");
const output = join(root, "logi", "dist", `Turnkey_${version.replaceAll(".", "_")}.lplug4`);
const run = (command: string, args: string[], cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });

run("npm", ["run", "build"]);
rmSync(release, { recursive: true, force: true });
run("dotnet", ["build", "-c", "Release"], project);
mkdirSync(join(root, "logi", "dist"), { recursive: true });
run("logiplugintool", ["pack", release, output]);
run("logiplugintool", ["verify", output]);
console.log(`packed ${output}`);
