import { defineConfig } from "vitest/config";

export default defineConfig({
	// Actions use @action class decorators, which the bundler lowers for the plugin; Node can't parse them as written.
	oxc: { decorator: { legacy: true } },
});
