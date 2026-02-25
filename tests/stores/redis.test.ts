import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { redisStore } from "../../src/stores/redis.js";
import { makeRecord, makeResponse } from "../helpers.js";

/**
 * Mock Redis client backed by a Map with TTL support.
 * Implements SET NX/EX semantics matching ioredis / node-redis / @upstash/redis.
 */
function createMockRedis() {
	const data = new Map<string, { value: string; expireAt?: number }>();
	return {
		data,
		async get(key: string): Promise<string | null> {
			const entry = data.get(key);
			if (!entry) return null;
			if (entry.expireAt && Date.now() >= entry.expireAt) {
				data.delete(key);
				return null;
			}
			return entry.value;
		},
		async set(
			key: string,
			value: string,
			opts?: { NX?: boolean; EX?: number },
		): Promise<string | null> {
			if (opts?.NX) {
				const existing = data.get(key);
				if (existing && (!existing.expireAt || Date.now() < existing.expireAt)) {
					return null;
				}
			}
			data.set(key, {
				value,
				expireAt: opts?.EX ? Date.now() + opts.EX * 1000 : undefined,
			});
			return "OK";
		},
		async del(...keys: string[]): Promise<number> {
			let count = 0;
			for (const k of keys) {
				if (data.delete(k)) count++;
			}
			return count;
		},
	};
}

describe("redisStore", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("lock() returns true and saves the record when key does not exist", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });
		const record = makeRecord("key-1");

		const result = await store.lock("key-1", record);
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved).toEqual(record);
	});

	it("lock() returns false when key already exists", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });
		const original = makeRecord("key-1", "fp-original");
		const duplicate = makeRecord("key-1", "fp-duplicate");

		await store.lock("key-1", original);
		const result = await store.lock("key-1", duplicate);

		expect(result).toBe(false);
		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-original");
	});

	it("get() returns stored record", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		const saved = await store.get("key-1");
		expect(saved).toEqual(record);
	});

	it("get() returns undefined for non-existent key", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });

		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("complete() updates status and attaches response", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });
		const record = makeRecord("key-1");
		const response = makeResponse();

		await store.lock("key-1", record);
		await store.complete("key-1", response);

		const saved = await store.get("key-1");
		expect(saved?.status).toBe("completed");
		expect(saved?.response).toEqual(response);
	});

	it("complete() on non-existent key is a no-op", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });

		await store.complete("nonexistent", makeResponse());
		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("delete() removes record", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		expect(await store.get("key-1")).toBeDefined();

		await store.delete("key-1");
		expect(await store.get("key-1")).toBeUndefined();
	});

	it("record expires after TTL", async () => {
		const client = createMockRedis();
		const store = redisStore({ client, ttl: 60 });

		await store.lock("key-1", makeRecord("key-1"));
		expect(await store.get("key-1")).toBeDefined();

		vi.advanceTimersByTime(60 * 1000);
		expect(await store.get("key-1")).toBeUndefined();
	});

	it("lock() succeeds after TTL expiry (re-acquirable)", async () => {
		const client = createMockRedis();
		const store = redisStore({ client, ttl: 60 });

		await store.lock("key-1", makeRecord("key-1", "fp-first"));
		vi.advanceTimersByTime(60 * 1000);

		const result = await store.lock("key-1", makeRecord("key-1", "fp-second"));
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-second");
	});

	it("purge() returns 0 (no-op)", async () => {
		const client = createMockRedis();
		const store = redisStore({ client });

		await store.lock("key-1", makeRecord("key-1"));
		const purged = await store.purge();
		expect(purged).toBe(0);
	});

	it("passes custom TTL to Redis EX", async () => {
		const client = createMockRedis();
		let capturedOpts: { NX?: boolean; EX?: number } | undefined;
		const originalSet = client.set.bind(client);
		client.set = async (key: string, value: string, opts?: { NX?: boolean; EX?: number }) => {
			capturedOpts = opts;
			return originalSet(key, value, opts);
		};

		const store = redisStore({ client, ttl: 3600 });
		await store.lock("key-1", makeRecord("key-1"));

		expect(capturedOpts?.EX).toBe(3600);
		expect(capturedOpts?.NX).toBe(true);
	});

	it("uses default TTL of 86400 seconds (24 hours)", async () => {
		const client = createMockRedis();
		let capturedOpts: { NX?: boolean; EX?: number } | undefined;
		const originalSet = client.set.bind(client);
		client.set = async (key: string, value: string, opts?: { NX?: boolean; EX?: number }) => {
			capturedOpts = opts;
			return originalSet(key, value, opts);
		};

		const store = redisStore({ client });
		await store.lock("key-1", makeRecord("key-1"));

		expect(capturedOpts?.EX).toBe(86400);
	});

	it("complete() preserves TTL on update", async () => {
		const client = createMockRedis();
		let capturedOpts: { NX?: boolean; EX?: number } | undefined;
		const originalSet = client.set.bind(client);
		client.set = async (key: string, value: string, opts?: { NX?: boolean; EX?: number }) => {
			capturedOpts = opts;
			return originalSet(key, value, opts);
		};

		const store = redisStore({ client, ttl: 3600 });
		await store.lock("key-1", makeRecord("key-1"));
		await store.complete("key-1", makeResponse());

		// complete() should set EX but NOT NX (needs to overwrite)
		expect(capturedOpts?.EX).toBeDefined();
		expect(capturedOpts?.NX).toBeUndefined();
	});

	it("complete() uses remaining TTL from creation, not full TTL", async () => {
		const client = createMockRedis();
		let capturedOpts: { NX?: boolean; EX?: number } | undefined;
		const originalSet = client.set.bind(client);
		client.set = async (key: string, value: string, opts?: { NX?: boolean; EX?: number }) => {
			capturedOpts = opts;
			return originalSet(key, value, opts);
		};

		const store = redisStore({ client, ttl: 3600 });
		await store.lock("key-1", makeRecord("key-1"));

		// Simulate handler taking 600 seconds
		vi.advanceTimersByTime(600 * 1000);
		await store.complete("key-1", makeResponse());

		// Remaining TTL should be 3600 - 600 = 3000, not 3600
		expect(capturedOpts?.EX).toBe(3000);
	});
});
