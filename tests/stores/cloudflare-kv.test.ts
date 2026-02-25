import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kvStore } from "../../src/stores/cloudflare-kv.js";
import { makeRecord, makeResponse } from "../helpers.js";

/**
 * Minimal KVNamespace mock that stores data in a Map.
 * Only implements the subset used by kvStore.
 */
function createMockKV(): KVNamespaceMock {
	const data = new Map<string, string>();
	return {
		data,
		async get(key: string, opts?: { type?: string }) {
			const value = data.get(key);
			if (value === undefined) return null;
			if (opts?.type === "json") return JSON.parse(value);
			return value;
		},
		async put(key: string, value: string, _opts?: { expirationTtl?: number }) {
			data.set(key, value);
		},
		async delete(key: string) {
			data.delete(key);
		},
	};
}

interface KVNamespaceMock {
	data: Map<string, string>;
	get(key: string, opts?: { type?: string }): Promise<unknown>;
	put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
	delete(key: string): Promise<void>;
}

describe("kvStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("lock() returns true and saves the record when key does not exist", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });
		const record = makeRecord("key-1");

		const result = await store.lock("key-1", record);
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved).toEqual(record);
	});

	it("lock() returns false when key already exists", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });
		const original = makeRecord("key-1", "fp-original");
		const duplicate = makeRecord("key-1", "fp-duplicate");

		await store.lock("key-1", original);
		const result = await store.lock("key-1", duplicate);

		expect(result).toBe(false);
		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-original");
	});

	it("complete() updates record to completed with response", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });
		const record = makeRecord("key-1");
		const response = makeResponse();

		await store.lock("key-1", record);
		await store.complete("key-1", response);

		const saved = await store.get("key-1");
		expect(saved?.status).toBe("completed");
		expect(saved?.response).toEqual(response);
	});

	it("get() returns undefined for non-existent key", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });

		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("delete() removes the record", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		expect(await store.get("key-1")).toBeDefined();

		await store.delete("key-1");
		expect(await store.get("key-1")).toBeUndefined();
	});

	it("passes expirationTtl to KV put()", async () => {
		const kv = createMockKV();
		let capturedOpts: { expirationTtl?: number } | undefined;
		const originalPut = kv.put.bind(kv);
		kv.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
			capturedOpts = opts;
			return originalPut(key, value, opts);
		};

		const store = kvStore({ namespace: kv as never, ttl: 3600 });
		await store.lock("key-1", makeRecord("key-1"));

		expect(capturedOpts?.expirationTtl).toBe(3600);
	});

	it("uses default TTL of 86400 seconds (24 hours)", async () => {
		const kv = createMockKV();
		let capturedOpts: { expirationTtl?: number } | undefined;
		const originalPut = kv.put.bind(kv);
		kv.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
			capturedOpts = opts;
			return originalPut(key, value, opts);
		};

		const store = kvStore({ namespace: kv as never });
		await store.lock("key-1", makeRecord("key-1"));

		expect(capturedOpts?.expirationTtl).toBe(86400);
	});

	it("purge() returns 0 (KV handles expiration automatically)", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });

		await store.lock("key-1", makeRecord("key-1"));
		const purged = await store.purge();
		expect(purged).toBe(0);
	});

	it("complete() does nothing for non-existent key", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });

		// Should not throw
		await store.complete("nonexistent", makeResponse());
		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("complete() uses remaining TTL from creation, not full TTL", async () => {
		const kv = createMockKV();
		let capturedOpts: { expirationTtl?: number } | undefined;
		const originalPut = kv.put.bind(kv);
		kv.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
			capturedOpts = opts;
			return originalPut(key, value, opts);
		};

		const store = kvStore({ namespace: kv as never, ttl: 3600 });
		await store.lock("key-1", makeRecord("key-1"));

		// Simulate handler taking 600 seconds
		vi.advanceTimersByTime(600 * 1000);
		await store.complete("key-1", makeResponse());

		// Remaining TTL should be 3600 - 600 = 3000, not 3600
		expect(capturedOpts?.expirationTtl).toBe(3000);
	});

	it("lock() returns false when JSON.stringify throws", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });
		const record = makeRecord("key-1");

		vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
			throw new TypeError("BigInt serialization");
		});

		const result = await store.lock("key-1", record);
		expect(result).toBe(false);
		vi.restoreAllMocks();
	});

	it("complete() is a no-op when JSON.stringify throws", async () => {
		const kv = createMockKV();
		const store = kvStore({ namespace: kv as never });
		await store.lock("key-1", makeRecord("key-1"));

		vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
			throw new TypeError("BigInt serialization");
		});

		await store.complete("key-1", makeResponse());
		vi.restoreAllMocks();

		const saved = await store.get("key-1");
		expect(saved?.status).toBe("processing");
	});

	it("lock() read-back detects overwrite by concurrent writer with different fingerprint", async () => {
		const kv = createMockKV();
		const originalPut = kv.put.bind(kv);
		let putCount = 0;
		// Simulate concurrent writer overwriting between put and read-back
		kv.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
			await originalPut(key, value, opts);
			putCount++;
			if (putCount === 1) {
				// Concurrent writer overwrites with different fingerprint and lockId
				const hijacked = {
					...JSON.parse(value),
					fingerprint: "hijacked",
					lockId: "concurrent-writer-id",
				};
				await originalPut(key, JSON.stringify(hijacked), opts);
			}
		};

		const store = kvStore({ namespace: kv as never });
		const result = await store.lock("key-1", makeRecord("key-1", "original-fp"));
		expect(result).toBe(false);
	});

	it("lock() read-back detects overwrite by concurrent writer with same fingerprint", async () => {
		const kv = createMockKV();
		const originalPut = kv.put.bind(kv);
		let putCount = 0;
		// Simulate concurrent writer with same fingerprint but different lockId
		kv.put = async (key: string, value: string, opts?: { expirationTtl?: number }) => {
			await originalPut(key, value, opts);
			putCount++;
			if (putCount === 1) {
				// Concurrent writer has same fingerprint but different lockId
				const parsed = JSON.parse(value);
				const hijacked = { ...parsed, lockId: "concurrent-writer-id" };
				await originalPut(key, JSON.stringify(hijacked), opts);
			}
		};

		const store = kvStore({ namespace: kv as never });
		const result = await store.lock("key-1", makeRecord("key-1", "same-fp"));
		expect(result).toBe(false);
	});
});
