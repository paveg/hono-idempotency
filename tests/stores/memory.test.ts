import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStore } from "../../src/stores/memory.js";
import { makeRecord, makeResponse } from "../helpers.js";

describe("memoryStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// S1: lock() — key does not exist → true + value saved
	it("S1: lock() returns true and saves the record when key does not exist", async () => {
		const store = memoryStore();
		const record = makeRecord("key-1");

		const result = await store.lock("key-1", record);

		expect(result).toBe(true);
		const saved = await store.get("key-1");
		expect(saved).toEqual(record);
	});

	// S2: lock() — key already exists → false + value unchanged
	it("S2: lock() returns false and keeps original value when key exists", async () => {
		const store = memoryStore();
		const original = makeRecord("key-1", "fp-original");
		const duplicate = makeRecord("key-1", "fp-duplicate");

		await store.lock("key-1", original);
		const result = await store.lock("key-1", duplicate);

		expect(result).toBe(false);
		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-original");
	});

	// S3: get() / complete() — basic read/write
	it("S3: complete() updates record to completed with response", async () => {
		const store = memoryStore();
		const record = makeRecord("key-1");
		const response = makeResponse();

		await store.lock("key-1", record);
		await store.complete("key-1", response);

		const saved = await store.get("key-1");
		expect(saved?.status).toBe("completed");
		expect(saved?.response).toEqual(response);
	});

	// S4: TTL — stored → TTL elapsed → get → undefined
	it("S4: record expires after TTL", async () => {
		const store = memoryStore({ ttl: 1000 });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		expect(await store.get("key-1")).toBeDefined();

		vi.advanceTimersByTime(1001);

		expect(await store.get("key-1")).toBeUndefined();
	});

	// S5: lock() after TTL expiry → true (re-acquirable)
	it("S5: lock() succeeds after TTL expiry", async () => {
		const store = memoryStore({ ttl: 1000 });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		vi.advanceTimersByTime(1001);

		const newRecord = makeRecord("key-1", "fp-new");
		const result = await store.lock("key-1", newRecord);

		expect(result).toBe(true);
		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-new");
	});

	// S6: delete() — explicit delete → get returns undefined
	it("S6: delete() removes the record", async () => {
		const store = memoryStore();
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		expect(await store.get("key-1")).toBeDefined();

		await store.delete("key-1");
		expect(await store.get("key-1")).toBeUndefined();
	});

	it("get() returns undefined for non-existent key", async () => {
		const store = memoryStore();
		expect(await store.get("nonexistent")).toBeUndefined();
	});

	// GC: expired entries are removed from the Map, not just hidden by get()
	it("sweeps expired entries from internal Map on lock()", async () => {
		const store = memoryStore({ ttl: 1000 });

		await store.lock("old-1", makeRecord("old-1"));
		await store.lock("old-2", makeRecord("old-2"));
		expect(store.size).toBe(2);

		vi.advanceTimersByTime(1001);

		// lock() triggers sweep — expired entries are actually deleted from Map
		await store.lock("new-1", makeRecord("new-1"));
		expect(store.size).toBe(1);
	});

	it("does not sweep unexpired entries", async () => {
		const store = memoryStore({ ttl: 10000 });

		await store.lock("alive-1", makeRecord("alive-1"));
		vi.advanceTimersByTime(5000);
		await store.lock("alive-2", makeRecord("alive-2"));

		expect(store.size).toBe(2);
		expect(await store.get("alive-1")).toBeDefined();
		expect(await store.get("alive-2")).toBeDefined();
	});

	// maxSize: evicts oldest completed entries when capacity is exceeded
	it("evicts oldest completed entry when maxSize is reached", async () => {
		const store = memoryStore({ maxSize: 2 });

		await store.lock("a", makeRecord("a"));
		await store.complete("a", makeResponse());
		await store.lock("b", makeRecord("b"));
		await store.complete("b", makeResponse());
		expect(store.size).toBe(2);

		// Third insert triggers eviction of oldest completed ("a")
		await store.lock("c", makeRecord("c"));
		expect(store.size).toBe(2);
		expect(await store.get("a")).toBeUndefined();
		expect(await store.get("b")).toBeDefined();
		expect(await store.get("c")).toBeDefined();
	});

	it("does not evict when under maxSize", async () => {
		const store = memoryStore({ maxSize: 10 });

		await store.lock("a", makeRecord("a"));
		await store.lock("b", makeRecord("b"));
		expect(store.size).toBe(2);
		expect(await store.get("a")).toBeDefined();
		expect(await store.get("b")).toBeDefined();
	});

	it("unlimited entries when maxSize is not set", async () => {
		const store = memoryStore();

		for (let i = 0; i < 100; i++) {
			await store.lock(`key-${i}`, makeRecord(`key-${i}`));
		}
		expect(store.size).toBe(100);
	});

	// purge() — explicit bulk cleanup
	it("purge() removes expired entries and returns count", async () => {
		const store = memoryStore({ ttl: 1000 });

		await store.lock("a", makeRecord("a"));
		await store.lock("b", makeRecord("b"));

		// Add "c" before time advances so it's not expired
		vi.advanceTimersByTime(500);
		await store.lock("c", makeRecord("c"));

		// Now expire "a" and "b" but not "c"
		vi.advanceTimersByTime(501);

		const purged = await store.purge();
		expect(purged).toBe(2);
		expect(store.size).toBe(1);
		expect(await store.get("c")).toBeDefined();
	});

	it("purge() returns 0 when nothing to clean", async () => {
		const store = memoryStore({ ttl: 10000 });

		await store.lock("a", makeRecord("a"));
		const purged = await store.purge();
		expect(purged).toBe(0);
		expect(store.size).toBe(1);
	});

	// Boundary: maxSize = 1
	it("maxSize: 1 keeps only the latest entry", async () => {
		const store = memoryStore({ maxSize: 1 });

		await store.lock("a", makeRecord("a"));
		await store.complete("a", makeResponse());
		expect(store.size).toBe(1);

		await store.lock("b", makeRecord("b"));
		expect(store.size).toBe(1);
		expect(await store.get("a")).toBeUndefined();
		expect(await store.get("b")).toBeDefined();
	});

	// Boundary: TTL exactly at boundary (>= means expired)
	it("record expires at exactly TTL milliseconds (>= boundary)", async () => {
		const store = memoryStore({ ttl: 1000 });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);

		// At TTL - 1ms: still alive
		vi.advanceTimersByTime(999);
		expect(await store.get("key-1")).toBeDefined();

		// At exactly TTL: expired (>= semantics)
		vi.advanceTimersByTime(1);
		expect(await store.get("key-1")).toBeUndefined();
	});

	// Boundary: lock() on expired entry at exact TTL boundary
	it("lock() re-acquires at exactly TTL boundary", async () => {
		const store = memoryStore({ ttl: 1000 });
		await store.lock("key-1", makeRecord("key-1", "fp-old"));

		vi.advanceTimersByTime(1000);

		const result = await store.lock("key-1", makeRecord("key-1", "fp-new"));
		expect(result).toBe(true);
		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-new");
	});

	// Edge: delete() on non-existent key is a no-op
	it("delete() on non-existent key does not throw", async () => {
		const store = memoryStore();
		await expect(store.delete("nonexistent")).resolves.toBeUndefined();
	});

	// Edge: complete() on non-existent key is a no-op
	it("complete() on non-existent key does not throw", async () => {
		const store = memoryStore();
		await expect(store.complete("nonexistent", makeResponse())).resolves.toBeUndefined();
	});

	// Edge: purge() on empty store returns 0
	it("purge() on empty store returns 0", async () => {
		const store = memoryStore();
		const purged = await store.purge();
		expect(purged).toBe(0);
		expect(store.size).toBe(0);
	});

	// maxSize eviction must not remove processing records (idempotency guarantee)
	it("maxSize eviction skips processing records to preserve idempotency", async () => {
		const store = memoryStore({ maxSize: 2 });

		// "a" is still processing (simulates a slow handler)
		await store.lock("a", makeRecord("a", "fp-a"));
		// "b" is completed
		await store.lock("b", makeRecord("b", "fp-b"));
		await store.complete("b", makeResponse());

		// "c" triggers eviction — must evict "b" (completed), not "a" (processing)
		await store.lock("c", makeRecord("c", "fp-c"));
		expect(store.size).toBe(2);
		expect(await store.get("a")).toBeDefined();
		expect((await store.get("a"))?.status).toBe("processing");
		expect(await store.get("b")).toBeUndefined();
		expect(await store.get("c")).toBeDefined();
	});

	it("maxSize eviction does not evict when all entries are processing", async () => {
		const store = memoryStore({ maxSize: 2 });

		await store.lock("a", makeRecord("a"));
		await store.lock("b", makeRecord("b"));

		// Both are processing — eviction should fail gracefully, allowing size > maxSize
		const result = await store.lock("c", makeRecord("c"));
		expect(result).toBe(true);
		expect(store.size).toBe(3); // exceeds maxSize because all are processing
		expect(await store.get("a")).toBeDefined();
		expect(await store.get("b")).toBeDefined();
		expect(await store.get("c")).toBeDefined();
	});

	// Boundary: maxSize eviction with sweep interaction
	it("maxSize eviction after sweep removes only excess entries", async () => {
		const store = memoryStore({ ttl: 1000, maxSize: 2 });

		await store.lock("a", makeRecord("a"));
		await store.lock("b", makeRecord("b"));
		expect(store.size).toBe(2);

		// Expire both
		vi.advanceTimersByTime(1001);

		// lock() triggers sweep (removes a, b), then adds c — no eviction needed
		await store.lock("c", makeRecord("c"));
		expect(store.size).toBe(1);
		expect(await store.get("c")).toBeDefined();
	});

	it("uses default TTL of 24 hours", async () => {
		const store = memoryStore();
		const record = makeRecord("key-1");

		await store.lock("key-1", record);

		// 23h59m - still exists
		vi.advanceTimersByTime(24 * 60 * 60 * 1000 - 1000);
		expect(await store.get("key-1")).toBeDefined();

		// 24h + 1s - expired
		vi.advanceTimersByTime(2000);
		expect(await store.get("key-1")).toBeUndefined();
	});
});
