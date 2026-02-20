import { describe, expect, it } from "vitest";
import { generateFingerprint } from "../src/fingerprint.js";

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

	it("returns a hex-encoded SHA-256 hash (64 chars)", async () => {
		const hash = await generateFingerprint("POST", "/api/orders", "body");
		expect(hash).toMatch(/^[a-f0-9]{64}$/);
	});
});
