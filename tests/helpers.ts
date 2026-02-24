import type { IdempotencyRecord, StoredResponse } from "../src/types.js";

export const makeRecord = (key: string, fingerprint = "fp-abc"): IdempotencyRecord => ({
	key,
	fingerprint,
	status: "processing",
	createdAt: Date.now(),
});

export const makeResponse = (): StoredResponse => ({
	status: 200,
	headers: { "content-type": "application/json" },
	body: '{"ok":true}',
});
