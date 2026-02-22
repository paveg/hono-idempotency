import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { durableObjectStore } from "../../src/stores/durable-objects.js";
import type { IdempotencyRecord, StoredResponse } from "../../src/types.js";

/**
 * Mock DurableObjectStorage backed by a Map.
 * Mirrors the Cloudflare DO storage API subset used by durableObjectStore.
 */
function createMockStorage() {
	const data = new Map<string, unknown>();
	return {
		data,
		async get<T>(key: string): Promise<T | undefined> {
			return data.get(key) as T | undefined;
		},
		async put<T>(key: string, value: T): Promise<void> {
			data.set(key, value);
		},
		async delete(key: string): Promise<boolean> {
			return data.delete(key);
		},
		async list(options?: { prefix?: string }): Promise<Map<string, unknown>> {
			if (!options?.prefix) return new Map(data);
			const result = new Map<string, unknown>();
			for (const [k, v] of data) {
				if (k.startsWith(options.prefix)) {
					result.set(k, v);
				}
			}
			return result;
		},
	};
}

const makeRecord = (key: string, fingerprint = "fp-abc"): IdempotencyRecord => ({
	key,
	fingerprint,
	status: "processing",
	createdAt: Date.now(),
});

const makeResponse = (): StoredResponse => ({
	status: 200,
	headers: { "content-type": "application/json" },
	body: '{"ok":true}',
});

describe("durableObjectStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("lock() returns true and saves the record when key does not exist", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });
		const record = makeRecord("key-1");

		const result = await store.lock("key-1", record);
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved).toEqual(record);
	});

	it("lock() returns false when key already exists", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });
		const original = makeRecord("key-1", "fp-original");
		const duplicate = makeRecord("key-1", "fp-duplicate");

		await store.lock("key-1", original);
		const result = await store.lock("key-1", duplicate);

		expect(result).toBe(false);
		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-original");
	});

	it("get() returns stored record", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		const saved = await store.get("key-1");
		expect(saved).toEqual(record);
	});

	it("get() returns undefined for non-existent key", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });

		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("get() returns undefined for expired record", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage, ttl: 60_000 });

		await store.lock("key-1", makeRecord("key-1"));
		vi.advanceTimersByTime(60_000);

		expect(await store.get("key-1")).toBeUndefined();
	});

	it("complete() updates status and attaches response", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });
		const record = makeRecord("key-1");
		const response = makeResponse();

		await store.lock("key-1", record);
		await store.complete("key-1", response);

		const saved = await store.get("key-1");
		expect(saved?.status).toBe("completed");
		expect(saved?.response).toEqual(response);
	});

	it("complete() on non-existent key is a no-op", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });

		await store.complete("nonexistent", makeResponse());
		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("delete() removes record", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });

		await store.lock("key-1", makeRecord("key-1"));
		expect(await store.get("key-1")).toBeDefined();

		await store.delete("key-1");
		expect(await store.get("key-1")).toBeUndefined();
	});

	it("lock() succeeds after TTL expiry (re-acquirable)", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage, ttl: 60_000 });

		await store.lock("key-1", makeRecord("key-1", "fp-first"));
		vi.advanceTimersByTime(60_000);

		const result = await store.lock("key-1", makeRecord("key-1", "fp-second"));
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-second");
	});

	it("purge() removes expired records and returns count", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage, ttl: 60_000 });

		await store.lock("key-1", makeRecord("key-1"));
		await store.lock("key-2", makeRecord("key-2"));
		vi.advanceTimersByTime(60_000);
		await store.lock("key-3", makeRecord("key-3")); // still fresh

		const purged = await store.purge();
		expect(purged).toBe(2);
		expect(await store.get("key-3")).toBeDefined();
	});

	it("purge() returns 0 when no records are expired", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });

		await store.lock("key-1", makeRecord("key-1"));
		const purged = await store.purge();
		expect(purged).toBe(0);
	});

	it("uses default TTL of 86400000ms (24 hours)", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage });

		await store.lock("key-1", makeRecord("key-1"));

		vi.advanceTimersByTime(86_400_000 - 1);
		expect(await store.get("key-1")).toBeDefined();

		vi.advanceTimersByTime(1);
		expect(await store.get("key-1")).toBeUndefined();
	});

	it("supports custom TTL", async () => {
		const storage = createMockStorage();
		const store = durableObjectStore({ storage, ttl: 5_000 });

		await store.lock("key-1", makeRecord("key-1"));

		vi.advanceTimersByTime(4_999);
		expect(await store.get("key-1")).toBeDefined();

		vi.advanceTimersByTime(1);
		expect(await store.get("key-1")).toBeUndefined();
	});
});
