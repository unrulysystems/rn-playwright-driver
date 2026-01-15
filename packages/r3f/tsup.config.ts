import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		helpers: "src/helpers.ts",
		test: "src/test.ts",
	},
	format: ["cjs", "esm"],
	dts: true,
	clean: true,
	external: [
		"react",
		"three",
		"@react-three/fiber",
		"@playwright/test",
		"@0xbigboss/rn-playwright-driver",
		"@0xbigboss/rn-playwright-driver/test",
	],
});
