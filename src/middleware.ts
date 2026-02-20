import { createMiddleware } from "hono/factory";
import { IdempotencyErrors } from "./errors.js";
import { generateFingerprint } from "./fingerprint.js";
import type { IdempotencyStore } from "./stores/types.js";
import type { IdempotencyOptions, StoredResponse } from "./types.js";

const DEFAULT_METHODS = ["POST", "PATCH"];
const DEFAULT_MAX_KEY_LENGTH = 256;

export function idempotency(options: IdempotencyOptions) {
	const {
		store,
		headerName = "Idempotency-Key",
		fingerprint: customFingerprint,
		required = false,
		methods = DEFAULT_METHODS,
		maxKeyLength = DEFAULT_MAX_KEY_LENGTH,
	} = options;

	return createMiddleware(async (c, next) => {
		if (!methods.includes(c.req.method)) {
			return next();
		}

		const key = c.req.header(headerName);

		if (!key) {
			if (required) {
				const error = IdempotencyErrors.missingKey();
				return c.json(error, error.status as 400);
			}
			return next();
		}

		if (key.length > maxKeyLength) {
			const error = IdempotencyErrors.keyTooLong(maxKeyLength);
			return c.json(error, error.status as 400);
		}

		const body = await c.req.text();
		const fp = customFingerprint
			? await customFingerprint(c)
			: await generateFingerprint(c.req.method, c.req.path, body);

		const existing = await store.get(key);

		if (existing) {
			if (existing.status === "processing") {
				const error = IdempotencyErrors.conflict();
				return c.json(error, {
					status: error.status as 409,
					headers: { "Retry-After": "1" },
				});
			}

			// completed
			if (existing.fingerprint !== fp) {
				const error = IdempotencyErrors.fingerprintMismatch();
				return c.json(error, error.status as 422);
			}

			if (existing.response) {
				return replayResponse(c, existing.response);
			}
		}

		const record = {
			key,
			fingerprint: fp,
			status: "processing" as const,
			createdAt: Date.now(),
		};

		const locked = await store.lock(key, record);
		if (!locked) {
			const error = IdempotencyErrors.conflict();
			return c.json(error, {
				status: error.status as 409,
				headers: { "Retry-After": "1" },
			});
		}

		c.set("idempotencyKey", key);

		try {
			await next();
		} catch (err) {
			await store.delete(key);
			throw err;
		}

		const res = c.res;
		if (!res.ok) {
			// Non-2xx: delete key (Stripe pattern) so client can retry
			await store.delete(key);
			return;
		}

		const resBody = await res.text();
		const resHeaders: Record<string, string> = {};
		res.headers.forEach((v, k) => {
			resHeaders[k] = v;
		});

		const storedResponse: StoredResponse = {
			status: res.status,
			headers: resHeaders,
			body: resBody,
		};

		await store.complete(key, storedResponse);

		// Rebuild response since we consumed body
		c.res = new Response(resBody, {
			status: res.status,
			headers: res.headers,
		});
	});
}

function replayResponse(c: { header: (k: string, v: string) => void }, stored: StoredResponse) {
	const headers = new Headers(stored.headers);
	headers.set("Idempotency-Replayed", "true");

	return new Response(stored.body, {
		status: stored.status,
		headers,
	});
}
