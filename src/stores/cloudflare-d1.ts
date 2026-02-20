import type { IdempotencyRecord, StoredResponse } from "../types.js";
import type { IdempotencyStore } from "./types.js";

const DEFAULT_TABLE = "idempotency_keys";
const DEFAULT_TTL = 86400; // 24 hours in seconds
const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/** Minimal D1Database subset used by d1Store (avoids @cloudflare/workers-types dependency). */
export interface D1DatabaseLike {
	prepare(sql: string): D1PreparedStatementLike;
}

export interface D1PreparedStatementLike {
	bind(...params: unknown[]): D1PreparedStatementLike;
	run(): Promise<{ success: boolean; meta: { changes: number } }>;
	first(): Promise<Record<string, unknown> | null>;
}

export interface D1StoreOptions {
	/** Cloudflare D1 database binding. */
	database: D1DatabaseLike;
	/** Table name (default: "idempotency_keys"). Must match /^[a-zA-Z_][a-zA-Z0-9_]*$/. */
	tableName?: string;
	/** TTL in seconds (default: 86400 = 24h). Expired rows are ignored by get/lock. */
	ttl?: number;
}

export function d1Store(options: D1StoreOptions): IdempotencyStore {
	const { database: db, tableName = DEFAULT_TABLE, ttl = DEFAULT_TTL } = options;

	if (!TABLE_NAME_RE.test(tableName)) {
		throw new Error(`Invalid table name: "${tableName}". Must match ${TABLE_NAME_RE}`);
	}

	let initialized = false;

	const ensureTable = async (): Promise<void> => {
		if (initialized) return;
		await db
			.prepare(
				`CREATE TABLE IF NOT EXISTS ${tableName} (
				key TEXT PRIMARY KEY,
				fingerprint TEXT NOT NULL,
				status TEXT NOT NULL,
				response TEXT,
				created_at INTEGER NOT NULL
			)`,
			)
			.run();
		initialized = true;
	};

	const ttlThreshold = (): number => {
		return Date.now() - ttl * 1000;
	};

	const toRecord = (row: Record<string, unknown>): IdempotencyRecord => ({
		key: row.key as string,
		fingerprint: row.fingerprint as string,
		status: row.status as "processing" | "completed",
		response: row.response ? (JSON.parse(row.response as string) as StoredResponse) : undefined,
		createdAt: row.created_at as number,
	});

	return {
		async get(key) {
			await ensureTable();
			const row = await db
				.prepare(`SELECT * FROM ${tableName} WHERE key = ? AND created_at >= ?`)
				.bind(key, ttlThreshold())
				.first();
			if (!row) return undefined;
			return toRecord(row);
		},

		async lock(key, record) {
			await ensureTable();
			const result = await db
				.prepare(
					`INSERT OR IGNORE INTO ${tableName} (key, fingerprint, status, response, created_at)
					SELECT ?, ?, ?, ?, ?
					WHERE NOT EXISTS (SELECT 1 FROM ${tableName} WHERE key = ? AND created_at >= ?)`,
				)
				.bind(key, record.fingerprint, record.status, null, record.createdAt, key, ttlThreshold())
				.run();
			return result.meta.changes > 0;
		},

		async complete(key, response) {
			await ensureTable();
			await db
				.prepare(`UPDATE ${tableName} SET status = ?, response = ? WHERE key = ?`)
				.bind("completed", JSON.stringify(response), key)
				.run();
		},

		async delete(key) {
			await ensureTable();
			await db.prepare(`DELETE FROM ${tableName} WHERE key = ?`).bind(key).run();
		},
	};
}
