export type IdempotencyErrorCode =
	| "MISSING_KEY"
	| "KEY_TOO_LONG"
	| "BODY_TOO_LARGE"
	| "FINGERPRINT_MISMATCH"
	| "CONFLICT";

export interface ProblemDetail {
	type: string;
	title: string;
	status: number;
	detail: string;
	code: IdempotencyErrorCode;
}

/** Ensures status is a valid HTTP status code (200-599), defaults to 500. */
export function clampHttpStatus(status: number): number {
	if (Number.isNaN(status) || status < 200 || status > 599) return 500;
	return status;
}

export function problemResponse(
	problem: ProblemDetail,
	extraHeaders?: Record<string, string>,
): Response {
	let body: string;
	let status: number;
	try {
		body = JSON.stringify(problem);
		status = clampHttpStatus(problem.status);
	} catch {
		body = '{"title":"Internal Server Error","status":500}';
		status = 500;
	}
	return new Response(body, {
		status,
		headers: {
			"Content-Type": "application/problem+json",
			...extraHeaders,
		},
	});
}

const BASE_URL = "https://hono-idempotency.dev/errors";

export const IdempotencyErrors = {
	missingKey(): ProblemDetail {
		return {
			type: `${BASE_URL}/missing-key`,
			title: "Idempotency-Key header is required",
			status: 400,
			detail: "This endpoint requires an Idempotency-Key header",
			code: "MISSING_KEY",
		};
	},

	keyTooLong(maxLength: number): ProblemDetail {
		return {
			type: `${BASE_URL}/key-too-long`,
			title: "Idempotency-Key is too long",
			status: 400,
			detail: `Idempotency-Key must be at most ${maxLength} characters`,
			code: "KEY_TOO_LONG",
		};
	},

	bodyTooLarge(maxSize: number): ProblemDetail {
		return {
			type: `${BASE_URL}/body-too-large`,
			title: "Request body is too large",
			status: 413,
			detail: `Request body must be at most ${maxSize} bytes`,
			code: "BODY_TOO_LARGE",
		};
	},

	fingerprintMismatch(): ProblemDetail {
		return {
			type: `${BASE_URL}/fingerprint-mismatch`,
			title: "Idempotency-Key is already used with a different request",
			status: 422,
			detail:
				"A request with the same idempotency key but different parameters was already processed",
			code: "FINGERPRINT_MISMATCH",
		};
	},

	conflict(): ProblemDetail {
		return {
			type: `${BASE_URL}/conflict`,
			title: "A request is outstanding for this idempotency key",
			status: 409,
			detail: "A request with the same idempotency key is currently being processed",
			code: "CONFLICT",
		};
	},
} as const;
