import type { IdempotencyRecord, StoredResponse } from "../types.js";

export interface IdempotencyStore {
	/** Get a record by key. Returns undefined if not found. */
	get(key: string): Promise<IdempotencyRecord | undefined>;

	/**
	 * Attempt to lock a key (save in "processing" state).
	 * Returns false if the key already exists (optimistic lock).
	 */
	lock(key: string, record: IdempotencyRecord): Promise<boolean>;

	/** Save the response and mark the record as "completed". */
	complete(key: string, response: StoredResponse): Promise<void>;

	/** Delete a key (cleanup on error). */
	delete(key: string): Promise<void>;
}
