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

	it("does not warn when cacheKeyPrefix is a static string", () => {
		idempotency({ store: memoryStore(), cacheKeyPrefix: "tenant" });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("does not warn when cacheKeyPrefix is a function", () => {
		idempotency({ store: memoryStore(), cacheKeyPrefix: () => "tenant:" });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("does not warn when cacheKeyPrefix is an empty string (treated as set)", () => {
		idempotency({ store: memoryStore(), cacheKeyPrefix: "" });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("does not warn when dangerouslyAllowGlobalKeys is true", () => {
		idempotency({ store: memoryStore(), dangerouslyAllowGlobalKeys: true });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("does not warn when methods contain no mutating verbs", () => {
		idempotency({ store: memoryStore(), methods: ["GET"] });
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("warns once per factory call (no module-level dedup)", () => {
		idempotency({ store: memoryStore(), methods: ["POST"] });
		idempotency({ store: memoryStore(), methods: ["POST"] });
		expect(warnSpy).toHaveBeenCalledTimes(2);
	});

	it("normalizes method casing when checking for mutating verbs", () => {
		idempotency({ store: memoryStore(), methods: ["post"] });
		expect(warnSpy).toHaveBeenCalledTimes(1);
	});
});
