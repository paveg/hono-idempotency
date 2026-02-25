import { bench, describe } from "vitest";
import { generateFingerprint } from "../src/fingerprint.js";

describe("generateFingerprint", () => {
	bench("short body", async () => {
		await generateFingerprint("POST", "/api/orders", '{"item":"widget"}');
	});

	bench("medium body (1KB)", async () => {
		const body = JSON.stringify({ data: "x".repeat(1000) });
		await generateFingerprint("POST", "/api/orders", body);
	});

	bench("large body (10KB)", async () => {
		const body = JSON.stringify({ data: "x".repeat(10000) });
		await generateFingerprint("POST", "/api/orders", body);
	});
});
