import type { IdempotencyStore } from "./types.js";

interface KVStoreOptions {
	binding: string;
	ttl?: number;
}

// Phase 2: Cloudflare KV store implementation
export function kvStore(_options: KVStoreOptions): IdempotencyStore {
	throw new Error("cloudflare-kv store is not yet implemented. Coming in Phase 2.");
}
