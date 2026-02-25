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

/**
 * KV is eventually consistent — lock() uses write-first with read-back
 * verification for best-effort race detection but cannot guarantee atomicity.
 * For strict concurrency guarantees, use d1Store or durableObjectStore.
 */
export function kvStore(options: KVStoreOptions): IdempotencyStore {
	const { namespace: kv, ttl = DEFAULT_TTL } = options;

	return {
		async get(key) {
			const record = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			return record ?? undefined;
		},

		async lock(key, record) {
			const existing = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			if (existing) return false;

			await kv.put(key, JSON.stringify(record), { expirationTtl: ttl });

			// Read-back verification: detect if a concurrent writer overwrote our record
			const stored = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			return stored?.fingerprint === record.fingerprint;
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

		async purge() {
			// KV handles expiration automatically via expirationTtl — no manual purge needed
			return 0;
		},
	};
}
