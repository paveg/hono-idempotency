import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { d1Store } from "../../src/stores/cloudflare-d1.js";
import type { IdempotencyRecord, StoredResponse } from "../../src/types.js";

/**
 * Minimal D1Database mock that uses a Map to simulate SQL storage.
 * Supports TTL filtering via created_at threshold bound parameters.
 */
function createMockD1(): D1DatabaseMock {
	const rows = new Map<string, Record<string, unknown>>();

	function createStatement(sql: string) {
		let boundParams: unknown[] = [];

		const stmt = {
			bind(...params: unknown[]) {
				boundParams = params;
				return stmt;
			},
			async run() {
				if (sql.startsWith("CREATE TABLE")) {
					return { success: true, meta: { changes: 0 } };
				}
				if (sql.startsWith("INSERT OR IGNORE")) {
					// Params: key, fingerprint, status, response, created_at, key, ttlThreshold
					const key = boundParams[0] as string;
					const ttlThreshold = boundParams[6] as number | undefined;
					const existing = rows.get(key);
					if (existing) {
						// Check TTL: if expired (created_at < threshold), allow overwrite
						if (ttlThreshold !== undefined && (existing.created_at as number) < ttlThreshold) {
							rows.delete(key);
						} else {
							return { success: true, meta: { changes: 0 } };
						}
					}
					rows.set(key, {
						key,
						fingerprint: boundParams[1],
						status: boundParams[2],
						response: boundParams[3],
						created_at: boundParams[4],
					});
					return { success: true, meta: { changes: 1 } };
				}
				if (sql.startsWith("UPDATE")) {
					const key = boundParams[2] as string;
					const row = rows.get(key);
					if (row) {
						row.status = boundParams[0];
						row.response = boundParams[1];
					}
					return { success: true, meta: { changes: row ? 1 : 0 } };
				}
				if (sql.startsWith("DELETE")) {
					const key = boundParams[0] as string;
					rows.delete(key);
					return { success: true, meta: { changes: 1 } };
				}
				return { success: true, meta: { changes: 0 } };
			},
			async first() {
				if (sql.startsWith("SELECT")) {
					const key = boundParams[0] as string;
					const ttlThreshold = boundParams[1] as number | undefined;
					const row = rows.get(key);
					if (!row) return null;
					if (ttlThreshold !== undefined && (row.created_at as number) < ttlThreshold) {
						return null;
					}
					return row;
				}
				return null;
			},
		};
		return stmt;
	}

	return {
		rows,
		prepare: (sql: string) => createStatement(sql),
	};
}

interface D1DatabaseMock {
	rows: Map<string, Record<string, unknown>>;
	prepare(sql: string): {
		bind(...params: unknown[]): {
			run(): Promise<{ success: boolean; meta: { changes: number } }>;
			first(): Promise<Record<string, unknown> | null>;
		};
		run(): Promise<{ success: boolean; meta: { changes: number } }>;
		first(): Promise<Record<string, unknown> | null>;
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

describe("d1Store", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("lock() returns true and saves the record when key does not exist", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never });
		const record = makeRecord("key-1");

		const result = await store.lock("key-1", record);
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved?.key).toBe("key-1");
		expect(saved?.fingerprint).toBe("fp-abc");
		expect(saved?.status).toBe("processing");
	});

	it("lock() returns false when key already exists", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never });
		const original = makeRecord("key-1", "fp-original");
		const duplicate = makeRecord("key-1", "fp-duplicate");

		await store.lock("key-1", original);
		const result = await store.lock("key-1", duplicate);

		expect(result).toBe(false);
		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-original");
	});

	it("complete() updates record to completed with response", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never });
		const record = makeRecord("key-1");
		const response = makeResponse();

		await store.lock("key-1", record);
		await store.complete("key-1", response);

		const saved = await store.get("key-1");
		expect(saved?.status).toBe("completed");
		expect(saved?.response).toEqual(response);
	});

	it("get() returns undefined for non-existent key", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never });

		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("delete() removes the record", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never });
		const record = makeRecord("key-1");

		await store.lock("key-1", record);
		expect(await store.get("key-1")).toBeDefined();

		await store.delete("key-1");
		expect(await store.get("key-1")).toBeUndefined();
	});

	it("complete() does nothing for non-existent key", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never });

		await store.complete("nonexistent", makeResponse());
		expect(await store.get("nonexistent")).toBeUndefined();
	});

	it("uses custom table name", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never, tableName: "custom_table" });
		const record = makeRecord("key-1");

		const result = await store.lock("key-1", record);
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved?.key).toBe("key-1");
	});

	// TTL: expired entries are not returned by get()
	it("get() returns undefined for expired entries", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never, ttl: 1 }); // 1 second

		await store.lock("key-1", makeRecord("key-1"));
		expect(await store.get("key-1")).toBeDefined();

		vi.advanceTimersByTime(1001); // 1001ms > 1s TTL

		expect(await store.get("key-1")).toBeUndefined();
	});

	// TTL: lock() succeeds after TTL expiry
	it("lock() succeeds after TTL expiry (re-acquirable)", async () => {
		const db = createMockD1();
		const store = d1Store({ database: db as never, ttl: 1 }); // 1 second

		await store.lock("key-1", makeRecord("key-1", "fp-old"));

		vi.advanceTimersByTime(1001); // 1001ms > 1s TTL

		const result = await store.lock("key-1", makeRecord("key-1", "fp-new"));
		expect(result).toBe(true);

		const saved = await store.get("key-1");
		expect(saved?.fingerprint).toBe("fp-new");
	});

	// tableName validation
	it("throws on invalid table name", () => {
		const db = createMockD1();
		expect(() => d1Store({ database: db as never, tableName: "keys; DROP TABLE users--" })).toThrow(
			/invalid table name/i,
		);
	});

	it("accepts valid table names", () => {
		const db = createMockD1();
		expect(() => d1Store({ database: db as never, tableName: "my_keys" })).not.toThrow();
		expect(() => d1Store({ database: db as never, tableName: "_private" })).not.toThrow();
		expect(() => d1Store({ database: db as never, tableName: "Keys123" })).not.toThrow();
	});
});
