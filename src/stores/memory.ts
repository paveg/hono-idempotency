import type { IdempotencyRecord, StoredResponse } from "../types.js";
import type { IdempotencyStore } from "./types.js";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface MemoryStoreOptions {
	ttl?: number;
	/** Maximum number of entries. Oldest entries are evicted when exceeded. */
	maxSize?: number;
}

export interface MemoryStore extends IdempotencyStore {
	/** Number of entries currently in the store (including expired but not yet swept). */
	readonly size: number;
}

export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
	const ttl = options.ttl ?? DEFAULT_TTL;
	const maxSize = options.maxSize;
	const map = new Map<string, IdempotencyRecord>();

	const isExpired = (record: IdempotencyRecord): boolean => {
		return Date.now() - record.createdAt >= ttl;
	};

	const sweep = (): void => {
		for (const [key, record] of map) {
			if (isExpired(record)) {
				map.delete(key);
			}
		}
	};

	return {
		get size() {
			return map.size;
		},

		async get(key) {
			const record = map.get(key);
			if (!record) return undefined;
			if (isExpired(record)) {
				map.delete(key);
				return undefined;
			}
			return record;
		},

		async lock(key, record) {
			sweep();
			const existing = map.get(key);
			if (existing && !isExpired(existing)) {
				return false;
			}
			map.set(key, record);
			if (maxSize !== undefined) {
				while (map.size > maxSize) {
					const oldest = map.keys().next().value;
					if (oldest !== undefined) map.delete(oldest);
				}
			}
			return true;
		},

		async complete(key, response) {
			const record = map.get(key);
			if (record) {
				record.status = "completed";
				record.response = response;
			}
		},

		async delete(key) {
			map.delete(key);
		},
	};
}
