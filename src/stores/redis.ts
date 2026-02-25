import type { IdempotencyRecord, StoredResponse } from "../types.js";
import type { IdempotencyStore } from "./types.js";

const DEFAULT_TTL = 86400; // 24 hours in seconds

/** Minimal Redis client subset compatible with ioredis, node-redis, and @upstash/redis. */
export interface RedisClientLike {
	get(key: string): Promise<string | null>;
	set(key: string, value: string, options?: { NX?: boolean; EX?: number }): Promise<string | null>;
	del(...keys: string[]): Promise<number>;
}

export interface RedisStoreOptions {
	/** Redis client instance (ioredis, node-redis, or @upstash/redis). */
	client: RedisClientLike;
	/** TTL in seconds (default: 86400 = 24h). Passed as Redis EX option. */
	ttl?: number;
}

export function redisStore(options: RedisStoreOptions): IdempotencyStore {
	const { client, ttl = DEFAULT_TTL } = options;

	return {
		async get(key) {
			const raw = await client.get(key);
			if (!raw) return undefined;
			return JSON.parse(raw) as IdempotencyRecord;
		},

		async lock(key, record) {
			const result = await client.set(key, JSON.stringify(record), { NX: true, EX: ttl });
			return result === "OK";
		},

		async complete(key, response) {
			const raw = await client.get(key);
			if (!raw) return;
			const record = JSON.parse(raw) as IdempotencyRecord;
			record.status = "completed";
			record.response = response;
			const elapsed = Math.floor((Date.now() - record.createdAt) / 1000);
			const remaining = Math.max(1, ttl - elapsed);
			await client.set(key, JSON.stringify(record), { EX: remaining });
		},

		async delete(key) {
			await client.del(key);
		},

		async purge() {
			// Redis handles expiration automatically via EX — no manual purge needed
			return 0;
		},
	};
}
