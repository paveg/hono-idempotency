import type { Context, Env } from "hono";
import type { ProblemDetail } from "./errors.js";
import type { IdempotencyStore } from "./stores/types.js";

export const RECORD_STATUS_PROCESSING = "processing" as const;
export const RECORD_STATUS_COMPLETED = "completed" as const;

export interface IdempotencyEnv extends Env {
	Variables: {
		idempotencyKey: string | undefined;
	};
}

export interface StoredResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

export interface IdempotencyRecord {
	key: string;
	fingerprint: string;
	status: "processing" | "completed";
	response?: StoredResponse;
	createdAt: number;
}

export interface IdempotencyOptions {
	store: IdempotencyStore;
	headerName?: string;
	fingerprint?: (c: Context) => string | Promise<string>;
	required?: boolean;
	methods?: string[];
	maxKeyLength?: number;
	/**
	 * Maximum request body size in bytes. Pre-checked via Content-Length header,
	 * then enforced against actual body byte length.
	 * Only applies when an Idempotency-Key header is present.
	 * Requests without the key bypass this check regardless of this setting.
	 */
	maxBodySize?: number;
	/** Should be a lightweight, side-effect-free predicate. Avoid reading the request body. */
	skipRequest?: (c: Context) => boolean | Promise<boolean>;
	/** Return a Response with an error status (4xx/5xx). Returning 2xx bypasses idempotency guarantees. */
	onError?: (error: ProblemDetail, c: Context) => Response | Promise<Response>;
	cacheKeyPrefix?: string | ((c: Context) => string | Promise<string>);
	/**
	 * Called when a cached response is about to be replayed.
	 * Errors are swallowed — hooks must not affect request processing.
	 * `key` is the raw header value; sanitize before logging to prevent log injection.
	 */
	onCacheHit?: (key: string, c: Context) => void | Promise<void>;
	/**
	 * Called when a new request acquires the lock (before the handler runs).
	 * Fires on each lock acquisition, including retries after prior failures.
	 * Errors are swallowed — hooks must not affect request processing.
	 */
	onCacheMiss?: (key: string, c: Context) => void | Promise<void>;
	/**
	 * Opt out of the multi-tenant safety warning.
	 *
	 * When `cacheKeyPrefix` is not set and `methods` includes any state-mutating
	 * method (POST/PATCH/PUT/DELETE), the middleware emits a one-time
	 * `console.warn` at factory construction time. Set this to `true` to
	 * acknowledge that the deployment is single-tenant and silence the warning.
	 *
	 * @default false
	 */
	dangerouslyAllowGlobalKeys?: boolean;
}
