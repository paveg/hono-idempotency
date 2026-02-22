import { defineConfig } from "tsup";

export default defineConfig({
	entry: {
		index: "src/index.ts",
		"stores/memory": "src/stores/memory.ts",
		"stores/cloudflare-kv": "src/stores/cloudflare-kv.ts",
		"stores/cloudflare-d1": "src/stores/cloudflare-d1.ts",
		"stores/redis": "src/stores/redis.ts",
	},
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
	external: ["hono"],
});
