import type { Context, Env } from "hono";
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
}
