import type { IdempotencyRecord, StoredResponse } from "../types.js";
import type { IdempotencyStore } from "./types.js";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours in ms

/** Minimal DurableObjectStorage subset (avoids @cloudflare/workers-types dependency). */
export interface DurableObjectStorageLike {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
	list(options?: { prefix?: string }): Promise<Map<string, unknown>>;
}

export interface DurableObjectStoreOptions {
	/** Durable Object storage instance (from `this.ctx.storage` inside a DO class). */
	storage: DurableObjectStorageLike;
	/** TTL in milliseconds (default: 86400000 = 24h). */
	ttl?: number;
}

export function durableObjectStore(options: DurableObjectStoreOptions): IdempotencyStore {
	const { storage, ttl = DEFAULT_TTL } = options;

	const isExpired = (record: IdempotencyRecord): boolean => {
		return Date.now() - record.createdAt >= ttl;
	};

	return {
		async get(key) {
			const record = await storage.get<IdempotencyRecord>(key);
			if (!record) return undefined;
			if (isExpired(record)) return undefined;
			return record;
		},

		async lock(key, record) {
			const existing = await storage.get<IdempotencyRecord>(key);
			if (existing && !isExpired(existing)) {
				return false;
			}
			await storage.put(key, record);
			return true;
		},

		async complete(key, response) {
			const record = await storage.get<IdempotencyRecord>(key);
			if (!record) return;
			record.status = "completed";
			record.response = response;
			await storage.put(key, record);
		},

		async delete(key) {
			await storage.delete(key);
		},

		async purge() {
			const entries = await storage.list();
			let count = 0;
			for (const [key, value] of entries) {
				const record = value as IdempotencyRecord;
				if (record.createdAt !== undefined && isExpired(record)) {
					await storage.delete(key);
					count++;
				}
			}
			return count;
		},
	};
}
