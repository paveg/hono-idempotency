// Type-compatibility consumer — compiled against multiple TS versions in CI.
// Never executed; exists purely to exercise every public .d.ts surface.
import type {
	D1DatabaseLike,
	D1PreparedStatementLike,
	D1StoreOptions,
	DurableObjectStorageLike,
	DurableObjectStoreOptions,
	IdempotencyEnv,
	IdempotencyErrorCode,
	IdempotencyOptions,
	IdempotencyRecord,
	IdempotencyStore,
	KVNamespaceLike,
	KVStoreOptions,
	MemoryStore,
	MemoryStoreOptions,
	ProblemDetail,
	RedisClientLike,
	RedisStoreOptions,
	StoredResponse,
} from "../../dist/index.js";
import {
	IdempotencyErrors,
	RECORD_STATUS_COMPLETED,
	RECORD_STATUS_PROCESSING,
	clampHttpStatus,
	idempotency,
	problemResponse,
} from "../../dist/index.js";
import { d1Store } from "../../dist/stores/cloudflare-d1.js";
import { kvStore } from "../../dist/stores/cloudflare-kv.js";
import { durableObjectStore } from "../../dist/stores/durable-objects.js";
import { memoryStore } from "../../dist/stores/memory.js";
import { redisStore } from "../../dist/stores/redis.js";

// --- value exports ---

const _statusCompleted: typeof RECORD_STATUS_COMPLETED = RECORD_STATUS_COMPLETED;
const _statusProcessing: typeof RECORD_STATUS_PROCESSING = RECORD_STATUS_PROCESSING;

const _clamped: number = clampHttpStatus(200);
const _clamped2: number = clampHttpStatus(999); // out-of-range → 500

const _problem: ProblemDetail = IdempotencyErrors.missingKey();
const _problem2: ProblemDetail = IdempotencyErrors.keyTooLong(256);
const _problem3: ProblemDetail = IdempotencyErrors.bodyTooLarge(1024);
const _problem4: ProblemDetail = IdempotencyErrors.fingerprintMismatch();
const _problem5: ProblemDetail = IdempotencyErrors.conflict();

// problemResponse returns Response — avoid annotating the bare type since types:[] excludes DOM
const _response = problemResponse(_problem);
const _response2 = problemResponse(_problem, { "X-Custom": "value" });

// --- type annotations ---

const _errorCode: IdempotencyErrorCode = "MISSING_KEY";

const _stored: StoredResponse = {
	status: 200,
	headers: { "content-type": "application/json" },
	body: '{"id":"pay_123"}',
};

const _record: IdempotencyRecord = {
	key: "my-key",
	fingerprint: "abc123",
	status: "processing",
	createdAt: Date.now(),
};

const _recordCompleted: IdempotencyRecord = {
	key: "my-key",
	fingerprint: "abc123",
	status: "completed",
	response: _stored,
	createdAt: Date.now(),
};

// IdempotencyEnv — used as type parameter
const _envCheck: IdempotencyEnv["Variables"] = { idempotencyKey: "key" };
const _envCheck2: IdempotencyEnv["Variables"] = { idempotencyKey: undefined };

// --- memoryStore ---

const _memOpts: MemoryStoreOptions = { ttl: 60000, maxSize: 100, sweepInterval: 30000 };
const _mem: MemoryStore = memoryStore(_memOpts);
const _memSize: number = _mem.size;

// --- idempotency middleware with memoryStore ---

const _opts: IdempotencyOptions = {
	store: _mem,
	cacheKeyPrefix: "tenant-a",
	required: false,
	methods: ["POST", "PATCH"],
	maxKeyLength: 256,
	maxBodySize: 1024 * 1024,
};
const _middleware = idempotency(_opts);

// IdempotencyStore interface
const _storeRef: IdempotencyStore = _mem;

// --- redisStore ---

const _redisClient: RedisClientLike = {
	get: async (_key: string) => null,
	set: async (_key: string, _value: string, _opts?: { NX?: boolean; EX?: number }) => null,
	del: async (..._keys: string[]) => 0,
};
const _redisOpts: RedisStoreOptions = { client: _redisClient, ttl: 86400 };
const _redis: IdempotencyStore = redisStore(_redisOpts);

// --- kvStore ---

const _kvNamespace: KVNamespaceLike = {
	get: async (_key: string, _opts: { type: "json" }) => null,
	put: async (_key: string, _value: string, _opts?: { expirationTtl?: number }) => {},
	delete: async (_key: string) => {},
};
const _kvOpts: KVStoreOptions = { namespace: _kvNamespace, ttl: 86400 };
const _kv: IdempotencyStore = kvStore(_kvOpts);

// --- d1Store ---

const _d1PreparedStmt: D1PreparedStatementLike = {
	bind: (..._params: unknown[]) => _d1PreparedStmt,
	run: async () => ({ success: true, meta: { changes: 1 } }),
	first: async () => null,
};
const _d1Db: D1DatabaseLike = {
	prepare: (_sql: string) => _d1PreparedStmt,
};
const _d1Opts: D1StoreOptions = { database: _d1Db, tableName: "idempotency_keys", ttl: 86400 };
const _d1: IdempotencyStore = d1Store(_d1Opts);

// --- durableObjectStore ---

const _doStorage: DurableObjectStorageLike = {
	get: async <T>(_key: string): Promise<T | undefined> => undefined,
	put: async <T>(_key: string, _value: T): Promise<void> => {},
	delete: async (_key: string) => true,
	list: async (_opts?: { prefix?: string }) => new Map<string, unknown>(),
};
const _doOpts: DurableObjectStoreOptions = { storage: _doStorage, ttl: 86400000 };
const _do: IdempotencyStore = durableObjectStore(_doOpts);

void _statusCompleted;
void _statusProcessing;
void _clamped;
void _clamped2;
void _problem;
void _problem2;
void _problem3;
void _problem4;
void _problem5;
void _response;
void _response2;
void _errorCode;
void _stored;
void _record;
void _recordCompleted;
void _envCheck;
void _envCheck2;
void _memOpts;
void _mem;
void _memSize;
void _opts;
void _middleware;
void _storeRef;
void _redisClient;
void _redisOpts;
void _redis;
void _kvNamespace;
void _kvOpts;
void _kv;
void _d1PreparedStmt;
void _d1Db;
void _d1Opts;
void _d1;
void _doStorage;
void _doOpts;
void _do;
