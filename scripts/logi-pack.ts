// Builds the Logitech plugin and packs it: `npm run logi:pack` writes logi/dist/Turnkey.lplug4.
// Needs the .NET SDK and LogiPluginTool (`dotnet tool install --global LogiPluginTool`); on macOS with Homebrew's .NET, set DOTNET_ROOT.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..");
const project = join(root, "logi", "TurnkeyPlugin");
const release = join(project, "bin", "Release");
// A fixed name, so the README can link releases/latest/download/Turnkey.lplug4.
const output = join(root, "logi", "dist", "Turnkey.lplug4");
const run = (command: string, args: string[], cwd = root) => execFileSync(command, args, { cwd, stdio: "inherit" });

run("npm", ["run", "build"]);
rmSync(release, { recursive: true, force: true });
run("dotnet", ["build", "-c", "Release"], project);
mkdirSync(join(root, "logi", "dist"), { recursive: true });
run("logiplugintool", ["pack", release, output]);
run("logiplugintool", ["verify", output]);
console.log(`packed ${output}`);
