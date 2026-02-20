import type { IdempotencyRecord, StoredResponse } from "../types.js";
import type { IdempotencyStore } from "./types.js";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

interface MemoryStoreOptions {
	ttl?: number;
}

export function memoryStore(options: MemoryStoreOptions = {}): IdempotencyStore {
	const ttl = options.ttl ?? DEFAULT_TTL;
	const map = new Map<string, IdempotencyRecord>();

	const isExpired = (record: IdempotencyRecord): boolean => {
		return Date.now() - record.createdAt >= ttl;
	};

	return {
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
			const existing = map.get(key);
			if (existing && !isExpired(existing)) {
				return false;
			}
			map.set(key, record);
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
