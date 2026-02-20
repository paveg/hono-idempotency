import type { IdempotencyStore } from "./types.js";

interface D1StoreOptions {
	binding: string;
	tableName?: string;
}

// Phase 2: Cloudflare D1 store implementation
export function d1Store(_options: D1StoreOptions): IdempotencyStore {
	throw new Error("cloudflare-d1 store is not yet implemented. Coming in Phase 2.");
}
