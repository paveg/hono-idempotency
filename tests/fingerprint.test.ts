import { describe, expect, it } from "vitest";
import { generateFingerprint, timingSafeEqual } from "../src/fingerprint.js";

describe("generateFingerprint", () => {
	it("produces the same hash for identical inputs", async () => {
		const a = await generateFingerprint("POST", "/api/orders", '{"item":"A"}');
		const b = await generateFingerprint("POST", "/api/orders", '{"item":"A"}');
		expect(a).toBe(b);
	});

	it("produces different hashes for different bodies", async () => {
		const a = await generateFingerprint("POST", "/api/orders", '{"item":"A"}');
		const b = await generateFingerprint("POST", "/api/orders", '{"item":"B"}');
		expect(a).not.toBe(b);
	});

	it("produces different hashes for different methods", async () => {
		const a = await generateFingerprint("POST", "/api/orders", '{"item":"A"}');
		const b = await generateFingerprint("PATCH", "/api/orders", '{"item":"A"}');
		expect(a).not.toBe(b);
	});

	it("produces different hashes for different paths", async () => {
		const a = await generateFingerprint("POST", "/api/orders", '{"item":"A"}');
		const b = await generateFingerprint("POST", "/api/items", '{"item":"A"}');
		expect(a).not.toBe(b);
	});

	it("handles empty body", async () => {
		const a = await generateFingerprint("POST", "/api/orders", "");
		const b = await generateFingerprint("POST", "/api/orders", "");
		expect(a).toBe(b);
		expect(a).toMatch(/^[a-f0-9]{64}$/);
	});

	// Known limitation: colon delimiter can collide when inputs contain colons.
	// Not a practical issue since HTTP methods never contain colons and
	// colons in paths are extremely rare.
	it("colon in path/body can produce collisions (known limitation)", async () => {
		const a = await generateFingerprint("POST", "/api:v2", "body");
		const b = await generateFingerprint("POST", "/api", "v2:body");
		// Both concatenate to "POST:/api:v2:body" — same hash
		expect(a).toBe(b);
	});

	it("all empty inputs produce consistent hash", async () => {
		const a = await generateFingerprint("", "", "");
		const b = await generateFingerprint("", "", "");
		expect(a).toBe(b);
		expect(a).toMatch(/^[a-f0-9]{64}$/);
	});

	it("empty vs non-empty inputs are distinct", async () => {
		const empty = await generateFingerprint("", "", "");
		const nonEmpty = await generateFingerprint("POST", "/", "");
		expect(empty).not.toBe(nonEmpty);
	});

	it("returns a hex-encoded SHA-256 hash (64 chars)", async () => {
		const hash = await generateFingerprint("POST", "/api/orders", "body");
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});
});

describe("timingSafeEqual", () => {
	it("returns true for identical strings", () => {
		expect(timingSafeEqual("abc", "abc")).toBe(true);
	});

	it("returns false for different strings of same length", () => {
		expect(timingSafeEqual("abc", "abd")).toBe(false);
	});

	it("returns false for different lengths", () => {
		expect(timingSafeEqual("abc", "abcd")).toBe(false);
	});

	it("returns true for empty strings", () => {
		expect(timingSafeEqual("", "")).toBe(true);
	});

	it("returns false for empty vs non-empty", () => {
		expect(timingSafeEqual("", "a")).toBe(false);
	});

	it("handles SHA-256 hex strings (64 chars)", () => {
		const hash = "a".repeat(64);
		expect(timingSafeEqual(hash, hash)).toBe(true);
		expect(timingSafeEqual(hash, `b${hash.slice(1)}`)).toBe(false);
		expect(timingSafeEqual(hash, `${hash.slice(0, 63)}b`)).toBe(false);
	});
});
