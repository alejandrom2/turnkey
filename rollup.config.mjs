import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import path from "node:path";
import url from "node:url";
import esbuild from "rollup-plugin-esbuild";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.alejandrom2.turnkey.sdPlugin";

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
	input: "src/plugin.ts",
	output: {
		file: `${sdPlugin}/bin/plugin.js`,
		sourcemap: isWatching,
		sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
			return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
		},
	},
	plugins: [
		{
			name: "watch-externals",
			buildStart: function () {
				this.addWatchFile(`${sdPlugin}/manifest.json`);
			},
		},
		// Transpiles only; `tsc --noEmit` type-checks. The plugin defaults to es2020, so match tsconfig's target.
		esbuild({ target: "es2022" }),
		nodeResolve({
			browser: false,
			exportConditions: ["node"],
			preferBuiltins: true,
		}),
		commonjs(),
		json(),
		!isWatching && terser(),
		{
			name: "emit-module-package-file",
			generateBundle() {
				this.emitFile({ fileName: "package.json", source: `{ "type": "module" }`, type: "asset" });
			},
		},
	],
};

/**
 * The Logitech plugin's sidecar: Turnkey's core over stdin and stdout, in one file with no native parts.
 * @type {import('rollup').RollupOptions}
 */
const sidecar = {
	...config,
	input: "src/logi/sidecar.ts",
	output: { ...config.output, file: "logi/bin/sidecar.js" },
	plugins: config.plugins.filter((plugin) => plugin && plugin.name !== "watch-externals"),
};

export default [config, sidecar];
