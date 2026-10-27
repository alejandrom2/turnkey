// Lets the asset scripts run src/*.ts directly: Node strips types but won't map the `.js` specifiers TypeScript wants to `.ts`.
import { registerHooks } from "node:module";

registerHooks({
	resolve(specifier, context, next) {
		try {
			return next(specifier, context);
		} catch (error) {
			if (specifier.startsWith(".") && specifier.endsWith(".js")) return next(`${specifier.slice(0, -3)}.ts`, context);
			throw error;
		}
	},
});
