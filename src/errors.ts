interface ProblemDetail {
	type: string;
	title: string;
	status: number;
	detail: string;
}

const BASE_URL = "https://hono-idempotency.dev/errors";

export const IdempotencyErrors = {
	missingKey(): ProblemDetail {
		return {
			type: `${BASE_URL}/missing-key`,
			title: "Idempotency-Key header is required",
			status: 400,
			detail: "This endpoint requires an Idempotency-Key header",
		};
	},

	keyTooLong(maxLength: number): ProblemDetail {
		return {
			type: `${BASE_URL}/missing-key`,
			title: "Idempotency-Key is too long",
			status: 400,
			detail: `Idempotency-Key must be at most ${maxLength} characters`,
		};
	},

	fingerprintMismatch(): ProblemDetail {
		return {
			type: `${BASE_URL}/fingerprint-mismatch`,
			title: "Idempotency-Key is already used with a different request",
			status: 422,
			detail:
				"A request with the same idempotency key but different parameters was already processed",
		};
	},

	conflict(): ProblemDetail {
		return {
			type: `${BASE_URL}/conflict`,
			title: "A request is outstanding for this idempotency key",
			status: 409,
			detail: "A request with the same idempotency key is currently being processed",
		};
	},
} as const;
