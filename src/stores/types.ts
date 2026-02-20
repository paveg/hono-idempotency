import type { IdempotencyRecord, StoredResponse } from "../types.js";

export interface IdempotencyStore {
	/**
	 * Get a record by key. Returns undefined if the key does not exist or has expired.
	 * Implementations should filter out expired records transparently.
	 */
	get(key: string): Promise<IdempotencyRecord | undefined>;

	/**
	 * Attempt to lock a key by storing a record in "processing" state.
	 * Must be atomic: if two concurrent calls race on the same key,
	 * exactly one must return true and the other false.
	 * Returns true if the lock was acquired, false if the key already exists.
	 * Expired keys should be treated as non-existent (lock succeeds).
	 */
	lock(key: string, record: IdempotencyRecord): Promise<boolean>;

	/**
	 * Mark a record as "completed" and attach the response.
	 * Called after the handler returns a 2xx response.
	 * If the key does not exist, this should be a no-op.
	 */
	complete(key: string, response: StoredResponse): Promise<void>;

	/**
	 * Delete a record. Called when the handler throws or returns non-2xx.
	 * Allows the client to retry with the same key.
	 */
	delete(key: string): Promise<void>;

	/**
	 * Physically remove expired records and return the count of deleted entries.
	 * For stores with automatic expiration (e.g., KV with expirationTtl),
	 * this may be a no-op returning 0.
	 */
	purge(): Promise<number>;
}
