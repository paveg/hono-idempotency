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
			const raw = (await kv.get(key, { type: "json" })) as
				| (IdempotencyRecord & { lockId?: string })
				| null;
			if (!raw) return undefined;
			// Strip internal lockId before returning to consumers
			const { lockId: _, ...record } = raw;
			return record;
		},

		async lock(key, record) {
			const existing = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			if (existing) return false;

			// Embed a unique lockId to distinguish concurrent writers with the same fingerprint
			const lockId = crypto.randomUUID();
			const withLock = { ...record, lockId };
			let serialized: string;
			try {
				serialized = JSON.stringify(withLock);
			} catch {
				return false;
			}
			await kv.put(key, serialized, { expirationTtl: ttl });

			// Read-back verification using lockId (not fingerprint) for reliable race detection
			const stored = (await kv.get(key, { type: "json" })) as
				| (IdempotencyRecord & { lockId?: string })
				| null;
			return stored?.lockId === lockId;
		},

		async complete(key, response) {
			const record = (await kv.get(key, { type: "json" })) as IdempotencyRecord | null;
			if (!record) return;
			record.status = "completed";
			record.response = response;
			const elapsed = Math.floor((Date.now() - record.createdAt) / 1000);
			const remaining = Math.max(1, ttl - elapsed);
			let serialized: string;
			try {
				serialized = JSON.stringify(record);
			} catch {
				return;
			}
			await kv.put(key, serialized, { expirationTtl: remaining });
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
