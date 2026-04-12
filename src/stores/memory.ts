import {
	type IdempotencyRecord,
	RECORD_STATUS_COMPLETED,
	RECORD_STATUS_PROCESSING,
	type StoredResponse,
} from "../types.js";
import type { IdempotencyStore } from "./types.js";

const DEFAULT_TTL = 24 * 60 * 60 * 1000; // 24 hours

export interface MemoryStoreOptions {
	ttl?: number;
	/** Maximum number of entries. Oldest entries are evicted when exceeded. */
	maxSize?: number;
	/** Minimum interval between sweeps in milliseconds (default: 60000). */
	sweepInterval?: number;
}

export interface MemoryStore extends IdempotencyStore {
	/** Number of entries currently in the store (including expired but not yet swept). */
	readonly size: number;
}

export function memoryStore(options: MemoryStoreOptions = {}): MemoryStore {
	const ttl = options.ttl ?? DEFAULT_TTL;
	const maxSize = options.maxSize;
	const sweepInterval = options.sweepInterval ?? 60_000;
	const map = new Map<string, IdempotencyRecord>();
	let lastSweep = Number.NEGATIVE_INFINITY;

	const isExpired = (record: IdempotencyRecord): boolean => {
		return Date.now() - record.createdAt >= ttl;
	};

	const sweepIfDue = (): void => {
		const now = Date.now();
		if (now - lastSweep < sweepInterval) return;
		lastSweep = now;
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
			sweepIfDue();
			const existing = map.get(key);
			if (existing && !isExpired(existing)) {
				return false;
			}
			map.set(key, record);
			if (maxSize !== undefined) {
				while (map.size > maxSize) {
					let evicted = false;
					for (const [k, r] of map) {
						if (r.status !== RECORD_STATUS_PROCESSING) {
							map.delete(k);
							evicted = true;
							break;
						}
					}
					if (!evicted) break;
				}
			}
			return true;
		},

		async complete(key, response) {
			const record = map.get(key);
			if (record) {
				record.status = RECORD_STATUS_COMPLETED;
				record.response = response;
			}
		},

		async delete(key) {
			map.delete(key);
		},

		async purge() {
			let count = 0;
			for (const [key, record] of map) {
				if (isExpired(record)) {
					map.delete(key);
					count++;
				}
			}
			return count;
		},
	};
}
