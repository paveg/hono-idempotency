import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idempotency } from "../src/middleware.js";
import { memoryStore } from "../src/stores/memory.js";

describe("idempotency() factory-time warning", () => {
	let warnSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warnSpy.mockRestore();
	});

	it("warns when cacheKeyPrefix is unset and methods include POST/PATCH (defaults)", () => {
		idempotency({ store: memoryStore() });
		expect(warnSpy).toHaveBeenCalledTimes(1);
		const message = warnSpy.mock.calls[0]?.[0];
		expect(message).toContain("[hono-idempotency] WARNING: cacheKeyPrefix is not configured.");
		expect(message).toContain("dangerouslyAllowGlobalKeys: true");
		expect(message).toContain("https://github.com/paveg/hono-idempotency#cachekeyprefix");
	});
});
