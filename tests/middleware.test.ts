import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { idempotency } from "../src/middleware.js";
import { memoryStore } from "../src/stores/memory.js";

function createApp(options: Parameters<typeof idempotency>[0] = {}) {
	const store = options.store ?? memoryStore();
	const app = new Hono();

	app.use("/api/*", idempotency({ store, ...options }));

	app.post("/api/text", (c) => c.text("hello"));
	app.post("/api/json", (c) => c.json({ message: "ok" }));
	app.post("/api/create", async (c) => {
		const body = await c.req.json();
		return c.json(body, 201);
	});
	app.post("/api/error", () => {
		throw new Error("handler error");
	});
	app.post("/api/server-error", (c) => c.json({ error: "fail" }, 500));
	app.post("/api/slow", async (c) => {
		await new Promise((resolve) => setTimeout(resolve, 100));
		return c.json({ done: true });
	});
	app.get("/api/get", (c) => c.text("get response"));
	app.patch("/api/update", (c) => c.json({ updated: true }));

	return { app, store };
}

describe("idempotency middleware", () => {
	// E1: same key → text response reuse
	it("E1: returns cached text response for same idempotency key", async () => {
		const { app } = createApp();
		const key = "key-e1";

		const res1 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);
		expect(await res1.text()).toBe("hello");

		const res2 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(await res2.text()).toBe("hello");
	});

	// E2: same key → JSON response reuse
	it("E2: returns cached JSON response for same idempotency key", async () => {
		const { app } = createApp();
		const key = "key-e2";

		const res1 = await app.request("/api/json", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);
		expect(await res1.json()).toEqual({ message: "ok" });

		const res2 = await app.request("/api/json", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ message: "ok" });
	});

	// E3: same key + body → reuse with correct status code
	it("E3: caches response with original status code (201)", async () => {
		const { app } = createApp();
		const key = "key-e3";
		const body = JSON.stringify({ item: "A" });

		const res1 = await app.request("/api/create", {
			method: "POST",
			headers: {
				"Idempotency-Key": key,
				"Content-Type": "application/json",
			},
			body,
		});
		expect(res1.status).toBe(201);

		const res2 = await app.request("/api/create", {
			method: "POST",
			headers: {
				"Idempotency-Key": key,
				"Content-Type": "application/json",
			},
			body,
		});
		expect(res2.status).toBe(201);
		expect(await res2.json()).toEqual({ item: "A" });
	});

	// E5: missing key + required: true → 400
	it("E5: returns 400 when key is missing and required is true", async () => {
		const { app } = createApp({ required: true });

		const res = await app.request("/api/text", { method: "POST" });
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.type).toContain("missing-key");
	});

	// E6: key too long → 400
	it("E6: returns 400 when key exceeds max length", async () => {
		const { app } = createApp({ maxKeyLength: 36 });
		const longKey = "a".repeat(37);

		const res = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": longKey },
		});
		expect(res.status).toBe(400);

		const body = await res.json();
		expect(body.title).toContain("too long");
	});

	// E7: concurrent requests → one 200, one 409
	it("E7: returns 409 Conflict for concurrent requests with same key", async () => {
		const { app } = createApp();
		const key = "key-e7";

		const [res1, res2] = await Promise.all([
			app.request("/api/slow", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			}),
			app.request("/api/slow", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			}),
		]);

		const statuses = [res1.status, res2.status].sort();
		expect(statuses).toEqual([200, 409]);
	});

	// E8: same key + different body → 422
	it("E8: returns 422 when same key is used with different body", async () => {
		const { app } = createApp();
		const key = "key-e8";

		const res1 = await app.request("/api/create", {
			method: "POST",
			headers: {
				"Idempotency-Key": key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ item: "A" }),
		});
		expect(res1.status).toBe(201);

		const res2 = await app.request("/api/create", {
			method: "POST",
			headers: {
				"Idempotency-Key": key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ item: "B" }),
		});
		expect(res2.status).toBe(422);

		const body = await res2.json();
		expect(body.type).toContain("fingerprint-mismatch");
	});

	// E9: Idempotency-Replayed header
	it("E9: sets Idempotency-Replayed: true on cached response", async () => {
		const { app } = createApp();
		const key = "key-e9";

		const res1 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.headers.get("Idempotency-Replayed")).toBeNull();

		const res2 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
	});

	// Handler exception → key deleted → retry possible
	it("deletes key on handler error, allowing retry", async () => {
		const store = memoryStore();
		const app = new Hono();
		app.use("/api/*", idempotency({ store }));
		app.post("/api/error", () => {
			throw new Error("boom");
		});

		// Use Hono's onError to return 500 but still test our middleware logic
		app.onError((err, c) => c.json({ error: err.message }, 500));

		const key = "key-error";
		const storeKey = `POST:/api/error:${key}`;
		const res1 = await app.request("/api/error", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(500);

		// Key should be deleted, so the same key can be used again
		const record = await store.get(storeKey);
		expect(record).toBeUndefined();
	});

	// Non-2xx response → key deleted (Stripe pattern)
	it("deletes key on non-2xx response, allowing retry", async () => {
		const store = memoryStore();
		const app = new Hono();
		app.use("/api/*", idempotency({ store }));
		app.post("/api/server-error", (c) => c.json({ error: "fail" }, 500));

		const key = "key-500";
		const storeKey = `POST:/api/server-error:${key}`;
		const res1 = await app.request("/api/server-error", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(500);

		const record = await store.get(storeKey);
		expect(record).toBeUndefined();
	});

	// No header + required: false → pass through
	it("passes through when key is missing and required is false", async () => {
		const { app } = createApp({ required: false });

		const res = await app.request("/api/text", { method: "POST" });
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("hello");
	});

	// GET method → pass through (not in default methods)
	it("passes through for GET requests (not in methods list)", async () => {
		const { app } = createApp();

		const res = await app.request("/api/get", {
			method: "GET",
			headers: { "Idempotency-Key": "key-get" },
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("get response");
	});

	// PATCH is in default methods
	it("applies idempotency to PATCH requests", async () => {
		const { app } = createApp();
		const key = "key-patch";

		const res1 = await app.request("/api/update", {
			method: "PATCH",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);

		const res2 = await app.request("/api/update", {
			method: "PATCH",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
	});

	// C1: basic flow (initial → store → retry → cached return)
	it("C1: full idempotency flow — initial, cache, replay", async () => {
		const store = memoryStore();
		const { app } = createApp({ store });
		const key = "key-c1";
		const storeKey = `POST:/api/json:${key}`;

		// Initial: no record
		expect(await store.get(storeKey)).toBeUndefined();

		const res1 = await app.request("/api/json", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);

		// After first request: record is completed
		const record = await store.get(storeKey);
		expect(record?.status).toBe("completed");
		expect(record?.response).toBeDefined();

		// Retry: returns cached
		const res2 = await app.request("/api/json", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ message: "ok" });
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
	});

	// Same key on different endpoints → treated as separate requests
	it("allows same key on different endpoints without conflict", async () => {
		const { app } = createApp();
		const key = "key-cross-endpoint";

		const res1 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);
		expect(await res1.text()).toBe("hello");

		const res2 = await app.request("/api/json", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ message: "ok" });
	});

	// Context access: c.get('idempotencyKey')
	it("exposes idempotency key via c.get('idempotencyKey')", async () => {
		const store = memoryStore();
		const app = new Hono();
		app.use("/api/*", idempotency({ store }));
		app.post("/api/context-check", (c) => {
			const idemKey = c.get("idempotencyKey");
			return c.json({ key: idemKey });
		});

		const res = await app.request("/api/context-check", {
			method: "POST",
			headers: { "Idempotency-Key": "my-key-123" },
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ key: "my-key-123" });
	});

	// E10: Retry-After header on 409
	it("E10: includes Retry-After header on 409 Conflict", async () => {
		const { app } = createApp();
		const key = "key-e10";

		const [res1, res2] = await Promise.all([
			app.request("/api/slow", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			}),
			app.request("/api/slow", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			}),
		]);

		const conflictRes = res1.status === 409 ? res1 : res2;
		expect(conflictRes.headers.get("Retry-After")).toBe("1");
	});

	// RFC 9457: error responses use application/problem+json
	describe("RFC 9457 Problem Details compliance", () => {
		it("400 missing key uses application/problem+json", async () => {
			const { app } = createApp({ required: true });
			const res = await app.request("/api/text", { method: "POST" });
			expect(res.headers.get("Content-Type")).toContain("application/problem+json");
		});

		it("400 key-too-long has correct type URI", async () => {
			const { app } = createApp({ maxKeyLength: 10 });
			const res = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": "a".repeat(11) },
			});
			const body = await res.json();
			expect(body.type).toContain("key-too-long");
			expect(body.type).not.toContain("missing-key");
		});

		it("422 fingerprint mismatch uses application/problem+json", async () => {
			const { app } = createApp();
			const key = "key-rfc9457-422";

			await app.request("/api/create", {
				method: "POST",
				headers: {
					"Idempotency-Key": key,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ a: 1 }),
			});

			const res = await app.request("/api/create", {
				method: "POST",
				headers: {
					"Idempotency-Key": key,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ a: 2 }),
			});

			expect(res.headers.get("Content-Type")).toContain("application/problem+json");
		});

		it("409 conflict uses application/problem+json", async () => {
			const { app } = createApp();
			const key = "key-rfc9457-409";

			const [res1, res2] = await Promise.all([
				app.request("/api/slow", {
					method: "POST",
					headers: { "Idempotency-Key": key },
				}),
				app.request("/api/slow", {
					method: "POST",
					headers: { "Idempotency-Key": key },
				}),
			]);

			const conflictRes = res1.status === 409 ? res1 : res2;
			expect(conflictRes.headers.get("Content-Type")).toContain("application/problem+json");
		});
	});

	// Response headers preserved on replay
	it("preserves Content-Type header on replayed response", async () => {
		const { app } = createApp();
		const key = "key-content-type";

		const res1 = await app.request("/api/json", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		const originalCT = res1.headers.get("Content-Type");
		expect(originalCT).toContain("application/json");

		const res2 = await app.request("/api/json", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.headers.get("Content-Type")).toBe(originalCT);
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
	});

	// Custom fingerprint function
	it("uses custom fingerprint function when provided", async () => {
		const store = memoryStore();
		const app = new Hono();
		app.use(
			"/api/*",
			idempotency({
				store,
				// Only use method + path, ignore body
				fingerprint: (c) => `${c.req.method}:${c.req.path}`,
			}),
		);
		app.post("/api/custom", (c) => c.json({ ok: true }));

		const key = "key-custom-fp";

		// First request with body A
		const res1 = await app.request("/api/custom", {
			method: "POST",
			headers: {
				"Idempotency-Key": key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ a: 1 }),
		});
		expect(res1.status).toBe(200);

		// Same key, different body — should still return cached (custom fp ignores body)
		const res2 = await app.request("/api/custom", {
			method: "POST",
			headers: {
				"Idempotency-Key": key,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ a: 2 }),
		});
		expect(res2.status).toBe(200);
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
	});

	// lock() race condition: get() returns undefined, but lock() returns false
	it("returns 409 when lock() fails due to race condition", async () => {
		let lockCallCount = 0;
		const inner = memoryStore();
		// Mock store: first lock() succeeds silently (simulating another request),
		// second lock() fails (our request loses the race)
		const racyStore = {
			get: () => inner.get("__never__"), // always returns undefined
			lock: async (...args: Parameters<typeof inner.lock>) => {
				lockCallCount++;
				if (lockCallCount === 1) {
					// First call: simulate race — another request locked it
					return false;
				}
				return inner.lock(...args);
			},
			complete: inner.complete.bind(inner),
			delete: inner.delete.bind(inner),
		};

		const app = new Hono();
		app.use("/api/*", idempotency({ store: racyStore }));
		app.post("/api/race", (c) => c.json({ ok: true }));

		const res = await app.request("/api/race", {
			method: "POST",
			headers: { "Idempotency-Key": "key-race-lock" },
		});
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.type).toContain("conflict");
		expect(res.headers.get("Retry-After")).toBe("1");
	});

	// Non-Error throw bypasses Hono's compose error handling,
	// causing next() to reject and triggering our catch block
	it("catch block deletes key when handler throws non-Error value", async () => {
		const store = memoryStore();
		const app = new Hono();
		app.use("/api/*", idempotency({ store }));
		app.post("/api/throw-string", () => {
			throw "non-error value";
		});

		const key = "key-non-error";
		const storeKey = `POST:/api/throw-string:${key}`;

		// Hono re-throws non-Error values all the way up
		await expect(
			app.request("/api/throw-string", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			}),
		).rejects.toBe("non-error value");

		// Catch block should have deleted the key before re-throwing
		const record = await store.get(storeKey);
		expect(record).toBeUndefined();
	});

	// Non-2xx response allows retry with same key (Stripe pattern E4 alternative)
	it("E4 alternative: error response is not cached, same key retries succeed", async () => {
		let callCount = 0;
		const store = memoryStore();
		const app = new Hono();
		app.use("/api/*", idempotency({ store }));
		app.post("/api/flaky", (c) => {
			callCount++;
			if (callCount === 1) {
				return c.json({ error: "temporary failure" }, 503);
			}
			return c.json({ success: true }, 200);
		});

		const key = "key-e4-retry";

		// First call: 503 error
		const res1 = await app.request("/api/flaky", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(503);

		// Retry with same key: handler runs again, returns 200
		const res2 = await app.request("/api/flaky", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(await res2.json()).toEqual({ success: true });
		expect(callCount).toBe(2);
	});
});
