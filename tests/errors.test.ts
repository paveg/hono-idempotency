import { describe, expect, it, vi } from "vitest";
import { IdempotencyErrors, problemResponse } from "../src/errors.js";

describe("problemResponse", () => {
	it("returns valid JSON response for normal ProblemDetail", () => {
		const problem = IdempotencyErrors.conflict();
		const res = problemResponse(problem);
		expect(res.status).toBe(409);
		expect(res.headers.get("Content-Type")).toBe("application/problem+json");
	});

	it("returns fallback 500 response when JSON.stringify throws", () => {
		const problem = IdempotencyErrors.conflict();
		vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
			throw new TypeError("Converting circular structure to JSON");
		});

		const res = problemResponse(problem);
		expect(res.status).toBe(500);
		vi.restoreAllMocks();
	});

	it("returns 500 for status below 200", () => {
		const problem = { ...IdempotencyErrors.conflict(), status: 99 };
		const res = problemResponse(problem);
		expect(res.status).toBe(500);
	});

	it("returns 500 for status above 599", () => {
		const problem = { ...IdempotencyErrors.conflict(), status: 999 };
		const res = problemResponse(problem);
		expect(res.status).toBe(500);
	});

	it("returns 500 for NaN status", () => {
		const problem = { ...IdempotencyErrors.conflict(), status: Number.NaN };
		const res = problemResponse(problem);
		expect(res.status).toBe(500);
	});

	it("preserves extraHeaders in fallback response", () => {
		vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
			throw new TypeError("stringify fail");
		});

		const res = problemResponse(IdempotencyErrors.conflict(), { "Retry-After": "1" });
		expect(res.status).toBe(500);
		expect(res.headers.get("Retry-After")).toBe("1");
		vi.restoreAllMocks();
	});
});
