import { createMiddleware } from "hono/factory";
import { getHonoProblemDetails } from "./compat.js";
import {
	IdempotencyErrors,
	type ProblemDetail,
	clampHttpStatus,
	problemResponse,
} from "./errors.js";
import { generateFingerprint, timingSafeEqual } from "./fingerprint.js";
import {
	type IdempotencyEnv,
	type IdempotencyOptions,
	RECORD_STATUS_PROCESSING,
	type StoredResponse,
} from "./types.js";

const DEFAULT_METHODS = ["POST", "PATCH"];
const DEFAULT_MAX_KEY_LENGTH = 256;
// Headers unsafe to replay — session cookies could leak across users
const EXCLUDED_STORE_HEADERS = new Set(["set-cookie", "content-length", "transfer-encoding"]);
const DEFAULT_RETRY_AFTER = "1";
const REPLAY_HEADER = "Idempotency-Replayed";
const encoder = new TextEncoder();

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
		maxBodySize,
		onCacheHit,
		onCacheMiss,
	} = options;

	return createMiddleware<IdempotencyEnv>(async (c, next) => {
		if (!methods.includes(c.req.method)) {
			return next();
		}

		if (skipRequest && (await skipRequest(c))) {
			return next();
		}

		const errorResponse = async (problem: ProblemDetail, extraHeaders?: Record<string, string>) => {
			if (onError) return onError(problem, c);
			const pd = await getHonoProblemDetails();
			if (pd) {
				const response = pd
					.problemDetails({
						type: problem.type,
						title: problem.title,
						status: problem.status,
						detail: problem.detail,
						extensions: { code: problem.code },
					})
					.getResponse();
				if (extraHeaders) {
					for (const [key, value] of Object.entries(extraHeaders)) {
						response.headers.set(key, value);
					}
				}
				return response;
			}
			return problemResponse(problem, extraHeaders);
		};

		const key = c.req.header(headerName);

		if (!key) {
			if (required) {
				return errorResponse(IdempotencyErrors.missingKey());
			}
			return next();
		}

		if (encoder.encode(key).length > maxKeyLength) {
			return errorResponse(IdempotencyErrors.keyTooLong(maxKeyLength));
		}

		// Pre-check Content-Length before reading body
		if (maxBodySize != null) {
			const cl = c.req.header("Content-Length");
			if (cl) {
				const parsed = Number.parseInt(cl, 10);
				if (parsed < 0 || parsed > maxBodySize) {
					return errorResponse(IdempotencyErrors.bodyTooLarge(maxBodySize));
				}
			}
		}

		const rawPrefix =
			typeof cacheKeyPrefix === "function" ? await cacheKeyPrefix(c) : cacheKeyPrefix;
		// Encode user-controlled components to prevent delimiter injection
		const encodedKey = encodeURIComponent(key);
		const baseKey = `${c.req.method}:${c.req.path}:${encodedKey}`;
		const storeKey = rawPrefix ? `${encodeURIComponent(rawPrefix)}:${baseKey}` : baseKey;

		const existing = await store.get(storeKey);

		if (existing) {
			if (existing.status === RECORD_STATUS_PROCESSING) {
				return errorResponse(IdempotencyErrors.conflict(), {
					"Retry-After": DEFAULT_RETRY_AFTER,
				});
			}

			const body = await c.req.text();

			if (maxBodySize != null) {
				const byteLength = encoder.encode(body).length;
				if (byteLength > maxBodySize) {
					return errorResponse(IdempotencyErrors.bodyTooLarge(maxBodySize));
				}
			}

			const fp = customFingerprint
				? await customFingerprint(c)
				: await generateFingerprint(c.req.method, c.req.path, body);

			if (!timingSafeEqual(existing.fingerprint, fp)) {
				return errorResponse(IdempotencyErrors.fingerprintMismatch());
			}

			if (existing.response) {
				await safeHook(onCacheHit, key, c);
				return replayResponse(existing.response);
			}

			// Completed but no response — corrupt record; delete so lock() can re-acquire
			await store.delete(storeKey);
		}

		const body = await c.req.text();

		if (maxBodySize != null) {
			const byteLength = encoder.encode(body).length;
			if (byteLength > maxBodySize) {
				return errorResponse(IdempotencyErrors.bodyTooLarge(maxBodySize));
			}
		}

		const fp = customFingerprint
			? await customFingerprint(c)
			: await generateFingerprint(c.req.method, c.req.path, body);

		const record = {
			key,
			fingerprint: fp,
			status: RECORD_STATUS_PROCESSING,
			createdAt: Date.now(),
		};

		const locked = await store.lock(storeKey, record);
		if (!locked) {
			return errorResponse(IdempotencyErrors.conflict(), {
				"Retry-After": DEFAULT_RETRY_AFTER,
			});
		}

		c.set("idempotencyKey", key);
		await safeHook(onCacheMiss, key, c);

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

// Hook errors must not break idempotency guarantees
async function safeHook<C>(
	fn: ((key: string, c: C) => void | Promise<void>) | undefined,
	key: string,
	c: C,
): Promise<void> {
	if (!fn) return;
	try {
		await fn(key, c);
	} catch {
		// Swallow — hooks are for observability, not control flow
	}
}

function replayResponse(stored: StoredResponse) {
	const headers = new Headers(stored.headers);
	headers.set(REPLAY_HEADER, "true");

	return new Response(stored.body, {
		status: clampHttpStatus(stored.status),
		headers,
	});
}
