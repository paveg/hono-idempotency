import { createMiddleware } from "hono/factory";
import { IdempotencyErrors, type ProblemDetail, problemResponse } from "./errors.js";
import { generateFingerprint } from "./fingerprint.js";
import type { IdempotencyEnv, IdempotencyOptions, StoredResponse } from "./types.js";

const DEFAULT_METHODS = ["POST", "PATCH"];
const DEFAULT_MAX_KEY_LENGTH = 256;
// Headers unsafe to replay — session cookies could leak across users
const EXCLUDED_STORE_HEADERS = new Set(["set-cookie"]);

export function idempotency(options: IdempotencyOptions) {
	const {
		store,
		headerName = "Idempotency-Key",
		fingerprint: customFingerprint,
		required = false,
		methods = DEFAULT_METHODS,
		maxKeyLength = DEFAULT_MAX_KEY_LENGTH,
		skipRequest,
		onError,
		cacheKeyPrefix,
	} = options;

	return createMiddleware<IdempotencyEnv>(async (c, next) => {
		if (!methods.includes(c.req.method)) {
			return next();
		}

		if (skipRequest && (await skipRequest(c))) {
			return next();
		}

		const errorResponse = (problem: ProblemDetail, extraHeaders?: Record<string, string>) =>
			onError ? onError(problem, c) : problemResponse(problem, extraHeaders);

		const key = c.req.header(headerName);

		if (!key) {
			if (required) {
				return errorResponse(IdempotencyErrors.missingKey());
			}
			return next();
		}

		if (key.length > maxKeyLength) {
			return errorResponse(IdempotencyErrors.keyTooLong(maxKeyLength));
		}

		const body = await c.req.text();
		const fp = customFingerprint
			? await customFingerprint(c)
			: await generateFingerprint(c.req.method, c.req.path, body);

		const rawPrefix =
			typeof cacheKeyPrefix === "function" ? await cacheKeyPrefix(c) : cacheKeyPrefix;
		// Encode user-controlled components to prevent delimiter injection
		const encodedKey = encodeURIComponent(key);
		const baseKey = `${c.req.method}:${c.req.path}:${encodedKey}`;
		const storeKey = rawPrefix ? `${encodeURIComponent(rawPrefix)}:${baseKey}` : baseKey;

		const existing = await store.get(storeKey);

		if (existing) {
			if (existing.status === "processing") {
				return errorResponse(IdempotencyErrors.conflict(), { "Retry-After": "1" });
			}

			if (existing.fingerprint !== fp) {
				return errorResponse(IdempotencyErrors.fingerprintMismatch());
			}

			if (existing.response) {
				return replayResponse(existing.response);
			}
		}

		const record = {
			key,
			fingerprint: fp,
			status: "processing" as const,
			createdAt: Date.now(),
		};

		const locked = await store.lock(storeKey, record);
		if (!locked) {
			return errorResponse(IdempotencyErrors.conflict(), { "Retry-After": "1" });
		}

		c.set("idempotencyKey", key);

		try {
			await next();
		} catch (err) {
			await store.delete(storeKey);
			throw err;
		}

		const res = c.res;
		if (!res.ok) {
			// Non-2xx: delete key (Stripe pattern) so client can retry
			await store.delete(storeKey);
			return;
		}

		const resBody = await res.text();
		const resHeaders: Record<string, string> = {};
		res.headers.forEach((v, k) => {
			if (!EXCLUDED_STORE_HEADERS.has(k.toLowerCase())) {
				resHeaders[k] = v;
			}
		});

		const storedResponse: StoredResponse = {
			status: res.status,
			headers: resHeaders,
			body: resBody,
		};

		await store.complete(storeKey, storedResponse);

		// Rebuild response since we consumed body
		c.res = new Response(resBody, {
			status: res.status,
			headers: res.headers,
		});
	});
}

function replayResponse(stored: StoredResponse) {
	const headers = new Headers(stored.headers);
	headers.set("Idempotency-Replayed", "true");

	return new Response(stored.body, {
		status: stored.status,
		headers,
	});
}
