import type { IdempotencyRecord, StoredResponse } from "../types.js";
import type { IdempotencyStore } from "./types.js";

const DEFAULT_TTL = 86400; // 24 hours in seconds

/** Minimal KVNamespace subset used by kvStore (avoids @cloudflare/workers-types dependency). */
export interface KVNamespaceLike {
	get(key: string, options: { type: "json" }): Promise<unknown>;
	put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

export interface KVStoreOptions {
	/** Cloudflare Workers KV namespace binding. */
	namespace: KVNamespaceLike;
	/** TTL in seconds (default: 86400 = 24h). KV minimum is 60 seconds. */
	ttl?: number;
}

export function kvStore(options: KVStoreOptions): IdempotencyStore {
	const { namespace: kv, ttl = DEFAULT_TTL } = options;

	return {
		async get(key) {
			const record = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			return record ?? undefined;
		},

		async lock(key, record) {
			const existing = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			if (existing) {
				return false;
			}
			await kv.put(key, JSON.stringify(record), { expirationTtl: ttl });
			return true;
		},

		async complete(key, response) {
			const record = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			if (!record) return;
			record.status = "completed";
			record.response = response;
			await kv.put(key, JSON.stringify(record), { expirationTtl: ttl });
		},

		async delete(key) {
			await kv.delete(key);
		},
	};
}
