import type { Context, Env } from "hono";
import type { ProblemDetail } from "./errors.js";
import type { IdempotencyStore } from "./stores/types.js";

export interface IdempotencyEnv extends Env {
	Variables: {
		idempotencyKey: string;
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
	/** Should be a lightweight, side-effect-free predicate. Avoid reading the request body. */
	skipRequest?: (c: Context) => boolean | Promise<boolean>;
	/** Return a Response with an error status (4xx/5xx). Returning 2xx bypasses idempotency guarantees. */
	onError?: (error: ProblemDetail, c: Context) => Response | Promise<Response>;
	cacheKeyPrefix?: string | ((c: Context) => string | Promise<string>);
}
