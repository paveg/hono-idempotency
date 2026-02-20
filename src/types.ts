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
	skipRequest?: (c: Context) => boolean | Promise<boolean>;
	onError?: (error: ProblemDetail, c: Context) => Response | Promise<Response>;
	cacheKeyPrefix?: string | ((c: Context) => string | Promise<string>);
}
