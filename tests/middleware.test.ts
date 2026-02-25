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

	// Boundary: key exactly at maxKeyLength is accepted
	it("accepts key of exactly maxKeyLength characters", async () => {
		const { app } = createApp({ maxKeyLength: 36 });
		const exactKey = "a".repeat(36);

		const res = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": exactKey },
		});
		expect(res.status).toBe(200);
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

	// C2: skipRequest
	describe("skipRequest", () => {
		it("C2: skips idempotency when skipRequest returns true", async () => {
			let callCount = 0;
			const store = memoryStore();
			const app = new Hono();
			app.use(
				"/api/*",
				idempotency({
					store,
					skipRequest: (c) => c.req.path === "/api/health",
				}),
			);
			app.post("/api/health", (c) => {
				callCount++;
				return c.json({ count: callCount });
			});

			const key = "key-skip";

			const res1 = await app.request("/api/health", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(res1.status).toBe(200);
			expect(await res1.json()).toEqual({ count: 1 });

			// Same key, but skipRequest bypasses idempotency — handler runs again
			const res2 = await app.request("/api/health", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(res2.status).toBe(200);
			expect(await res2.json()).toEqual({ count: 2 });
			expect(callCount).toBe(2);
		});

		it("applies idempotency when skipRequest returns false", async () => {
			const { app } = createApp({
				skipRequest: () => false,
			});
			const key = "key-no-skip";

			const res1 = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(res1.status).toBe(200);

			const res2 = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
		});

		it("supports async skipRequest function", async () => {
			let callCount = 0;
			const store = memoryStore();
			const app = new Hono();
			app.use(
				"/api/*",
				idempotency({
					store,
					skipRequest: async () => {
						await new Promise((r) => setTimeout(r, 1));
						return true;
					},
				}),
			);
			app.post("/api/async-skip", (c) => {
				callCount++;
				return c.json({ count: callCount });
			});

			await app.request("/api/async-skip", {
				method: "POST",
				headers: { "Idempotency-Key": "key-async-skip" },
			});
			await app.request("/api/async-skip", {
				method: "POST",
				headers: { "Idempotency-Key": "key-async-skip" },
			});

			expect(callCount).toBe(2);
		});
	});

	// C3: cacheKeyPrefix
	describe("cacheKeyPrefix", () => {
		it("C3: string prefix namespaces store keys", async () => {
			const store = memoryStore();
			const { app } = createApp({ store, cacheKeyPrefix: "tenant-a" });
			const key = "key-prefix";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});

			// Key should be stored with prefix
			const prefixed = await store.get(`tenant-a:POST:/api/text:${key}`);
			expect(prefixed?.status).toBe("completed");

			// Old format should NOT exist
			const unprefixed = await store.get(`POST:/api/text:${key}`);
			expect(unprefixed).toBeUndefined();
		});

		it("function prefix resolves dynamically per request", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use(
				"/api/*",
				idempotency({
					store,
					cacheKeyPrefix: (c) => c.req.header("X-Tenant-Id") ?? "default",
				}),
			);
			app.post("/api/text", (c) => c.text("hello"));

			const key = "key-dynamic-prefix";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key, "X-Tenant-Id": "tenant-x" },
			});

			const record = await store.get(`tenant-x:POST:/api/text:${key}`);
			expect(record?.status).toBe("completed");
		});

		it("same key with different prefixes → treated as separate requests", async () => {
			const store = memoryStore();
			const app = new Hono();
			let callCount = 0;
			app.use(
				"/api/*",
				idempotency({
					store,
					cacheKeyPrefix: (c) => c.req.header("X-Tenant-Id") ?? "default",
				}),
			);
			app.post("/api/counter", (c) => {
				callCount++;
				return c.json({ count: callCount });
			});

			const key = "shared-key";

			const res1 = await app.request("/api/counter", {
				method: "POST",
				headers: { "Idempotency-Key": key, "X-Tenant-Id": "tenant-a" },
			});
			expect(res1.status).toBe(200);
			expect(await res1.json()).toEqual({ count: 1 });

			// Same key, different tenant → handler runs again
			const res2 = await app.request("/api/counter", {
				method: "POST",
				headers: { "Idempotency-Key": key, "X-Tenant-Id": "tenant-b" },
			});
			expect(res2.status).toBe(200);
			expect(await res2.json()).toEqual({ count: 2 });
			expect(callCount).toBe(2);
		});

		it("prefix with special characters is encoded in store key", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use(
				"/api/*",
				idempotency({
					store,
					cacheKeyPrefix: (c) => c.req.header("X-Tenant-Id") ?? "default",
				}),
			);
			app.post("/api/text", (c) => c.text("hello"));

			const key = "key-special-prefix";
			const prefix = "org:acme/team:1";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key, "X-Tenant-Id": prefix },
			});

			// Prefix must be encoded — raw prefix contains `:` and `/`
			const encoded = `${encodeURIComponent(prefix)}:POST:/api/text:${encodeURIComponent(key)}`;
			const record = await store.get(encoded);
			expect(record?.status).toBe("completed");
		});

		it("no prefix → backwards compatible key format", async () => {
			const store = memoryStore();
			const { app } = createApp({ store });
			const key = "key-no-prefix";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});

			const record = await store.get(`POST:/api/text:${key}`);
			expect(record?.status).toBe("completed");
		});
	});

	// onError
	describe("onError", () => {
		it("receives ProblemDetail and returns custom response", async () => {
			const { app } = createApp({
				required: true,
				onError: (error) =>
					new Response(JSON.stringify({ custom: true, originalType: error.type }), {
						status: error.status,
						headers: { "Content-Type": "application/json" },
					}),
			});

			const res = await app.request("/api/text", { method: "POST" });
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.custom).toBe(true);
			expect(body.originalType).toContain("missing-key");
		});

		it("without onError → default RFC 9457 response", async () => {
			const { app } = createApp({ required: true });

			const res = await app.request("/api/text", { method: "POST" });
			expect(res.status).toBe(400);
			expect(res.headers.get("Content-Type")).toContain("application/problem+json");
		});

		it("error includes code field for programmatic identification", async () => {
			const errors: { code: string; status: number }[] = [];
			const store = memoryStore();
			const app = new Hono();
			app.use(
				"/api/*",
				idempotency({
					store,
					required: true,
					maxKeyLength: 10,
					onError: (error) => {
						errors.push({ code: (error as { code: string }).code, status: error.status });
						return new Response(null, { status: error.status });
					},
				}),
			);
			app.post("/api/test", (c) => c.text("ok"));

			// MISSING_KEY
			await app.request("/api/test", { method: "POST" });

			// KEY_TOO_LONG
			await app.request("/api/test", {
				method: "POST",
				headers: { "Idempotency-Key": "a".repeat(11) },
			});

			expect(errors[0].code).toBe("MISSING_KEY");
			expect(errors[1].code).toBe("KEY_TOO_LONG");
		});

		it("conflict and fingerprint mismatch have distinct codes", async () => {
			const { app } = createApp();
			const key = "key-code-check";

			// First request succeeds
			await app.request("/api/create", {
				method: "POST",
				headers: {
					"Idempotency-Key": key,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ a: 1 }),
			});

			// Fingerprint mismatch
			const res = await app.request("/api/create", {
				method: "POST",
				headers: {
					"Idempotency-Key": key,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ a: 2 }),
			});
			const body = await res.json();
			expect(body.code).toBe("FINGERPRINT_MISMATCH");
		});

		it("onError receives Hono context with request info", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use(
				"/api/*",
				idempotency({
					store,
					required: true,
					onError: (_error, c) =>
						new Response(JSON.stringify({ path: c.req.path, method: c.req.method }), {
							status: 400,
							headers: { "Content-Type": "application/json" },
						}),
				}),
			);
			app.post("/api/ctx-check", (c) => c.text("ok"));

			const res = await app.request("/api/ctx-check", { method: "POST" });
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.path).toBe("/api/ctx-check");
			expect(body.method).toBe("POST");
		});

		it("problemResponse can be used as fallback in onError", async () => {
			const { problemResponse } = await import("../src/index.js");
			const { app } = createApp({
				required: true,
				onError: (error) => {
					if (error.code === "MISSING_KEY") {
						return new Response(JSON.stringify({ custom: "missing" }), {
							status: 400,
							headers: { "Content-Type": "application/json" },
						});
					}
					return problemResponse(error);
				},
			});

			// MISSING_KEY → custom response
			const res1 = await app.request("/api/text", { method: "POST" });
			expect(res1.status).toBe(400);
			expect(res1.headers.get("Content-Type")).toBe("application/json");
			const body1 = await res1.json();
			expect(body1.custom).toBe("missing");

			// KEY_TOO_LONG → default problemResponse fallback
			const res2 = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": "x".repeat(300) },
			});
			expect(res2.status).toBe(400);
			expect(res2.headers.get("Content-Type")).toBe("application/problem+json");
			const body2 = await res2.json();
			expect(body2.code).toBe("KEY_TOO_LONG");
		});
	});

	// Observability hooks
	describe("observability hooks", () => {
		it("onCacheHit is called when replaying a cached response", async () => {
			const hits: string[] = [];
			const { app } = createApp({
				onCacheHit: (key) => {
					hits.push(key);
				},
			});
			const key = "key-cache-hit";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(hits).toEqual([]);

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(hits).toEqual([key]);
		});

		it("onCacheMiss is called when processing a new request", async () => {
			const misses: string[] = [];
			const { app } = createApp({
				onCacheMiss: (key) => {
					misses.push(key);
				},
			});
			const key = "key-cache-miss";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(misses).toEqual([key]);

			// Replay — onCacheMiss should NOT be called again
			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(misses).toEqual([key]);
		});

		it("both hooks work together", async () => {
			const hits: string[] = [];
			const misses: string[] = [];
			const { app } = createApp({
				onCacheHit: (key) => hits.push(key),
				onCacheMiss: (key) => misses.push(key),
			});
			const key = "key-both-hooks";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(misses).toEqual([key]);
			expect(hits).toEqual([]);

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(misses).toEqual([key]);
			expect(hits).toEqual([key]);
		});

		it("async hooks are awaited", async () => {
			const events: string[] = [];
			const { app } = createApp({
				onCacheHit: async () => {
					await new Promise((r) => setTimeout(r, 1));
					events.push("hit");
				},
				onCacheMiss: async () => {
					await new Promise((r) => setTimeout(r, 1));
					events.push("miss");
				},
			});
			const key = "key-async-hooks";

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(events).toEqual(["miss"]);

			await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(events).toEqual(["miss", "hit"]);
		});

		it("hooks receive context with request info", async () => {
			let hitPath = "";
			let missPath = "";
			const store = memoryStore();
			const app = new Hono();
			app.use(
				"/api/*",
				idempotency({
					store,
					onCacheHit: (_key, c) => {
						hitPath = c.req.path;
					},
					onCacheMiss: (_key, c) => {
						missPath = c.req.path;
					},
				}),
			);
			app.post("/api/hook-ctx", (c) => c.text("ok"));

			const key = "key-hook-ctx";
			await app.request("/api/hook-ctx", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(missPath).toBe("/api/hook-ctx");

			await app.request("/api/hook-ctx", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(hitPath).toBe("/api/hook-ctx");
		});

		it("hooks are not called when no idempotency key is present", async () => {
			const hits: string[] = [];
			const misses: string[] = [];
			const { app } = createApp({
				onCacheHit: (key) => hits.push(key),
				onCacheMiss: (key) => misses.push(key),
			});

			await app.request("/api/text", { method: "POST" });
			expect(hits).toEqual([]);
			expect(misses).toEqual([]);
		});

		it("hooks are not called for skipped methods", async () => {
			const misses: string[] = [];
			const { app } = createApp({
				onCacheMiss: (key) => misses.push(key),
			});

			await app.request("/api/get", {
				method: "GET",
				headers: { "Idempotency-Key": "key-get" },
			});
			expect(misses).toEqual([]);
		});

		it("onCacheMiss fires again after handler failure allows retry", async () => {
			const misses: string[] = [];
			const store = memoryStore();
			const app = new Hono();
			let callCount = 0;
			app.use("/api/*", idempotency({ store, onCacheMiss: (key) => misses.push(key) }));
			app.post("/api/flaky", (c) => {
				callCount++;
				return callCount === 1 ? c.json({ error: "fail" }, 500) : c.json({ ok: true });
			});

			const key = "key-miss-retry";
			await app.request("/api/flaky", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(misses).toEqual([key]);

			// Retry after 500 — key was deleted, so onCacheMiss fires again
			await app.request("/api/flaky", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(misses).toEqual([key, key]);
		});

		it("onCacheHit is not called on fingerprint mismatch", async () => {
			const hits: string[] = [];
			const { app } = createApp({ onCacheHit: (key) => hits.push(key) });
			const key = "key-hit-no-mismatch";

			await app.request("/api/create", {
				method: "POST",
				headers: {
					"Idempotency-Key": key,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ a: 1 }),
			});

			// Different body → 422 fingerprint mismatch
			await app.request("/api/create", {
				method: "POST",
				headers: {
					"Idempotency-Key": key,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ a: 2 }),
			});

			expect(hits).toEqual([]);
		});

		it("hook errors are swallowed and do not break idempotency", async () => {
			const { app } = createApp({
				onCacheHit: () => {
					throw new Error("hook exploded");
				},
				onCacheMiss: () => {
					throw new Error("hook exploded");
				},
			});
			const key = "key-hook-error";

			// onCacheMiss throws — request should still succeed
			const res1 = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(res1.status).toBe(200);

			// onCacheHit throws — replay should still succeed
			const res2 = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(res2.status).toBe(200);
			expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
		});
	});

	// Security: store key injection prevention
	describe("store key safety", () => {
		it("crafted prefix+key that would collide without encoding are isolated", async () => {
			const store = memoryStore();
			const app = new Hono();
			let callCount = 0;
			app.use(
				"/api/*",
				idempotency({
					store,
					cacheKeyPrefix: (c) => c.req.header("X-Tenant-Id") ?? "default",
				}),
			);
			app.post("/api/data", (c) => {
				callCount++;
				return c.json({ count: callCount });
			});

			// Without encoding, both produce the same store key:
			// "a:POST:/api/data:x:POST:/api/data:y"
			// Tenant "a" with key containing the method:path pattern
			await app.request("/api/data", {
				method: "POST",
				headers: {
					"Idempotency-Key": "x:POST:/api/data:y",
					"X-Tenant-Id": "a",
				},
			});

			// Tenant "a:POST:/api/data:x" with key "y"
			const res = await app.request("/api/data", {
				method: "POST",
				headers: {
					"Idempotency-Key": "y",
					"X-Tenant-Id": "a:POST:/api/data:x",
				},
			});

			// Must be a fresh response — not a replay from tenant "a"
			expect(res.headers.get("Idempotency-Replayed")).toBeNull();
			expect(callCount).toBe(2);
		});
	});

	// Security: Set-Cookie not replayed
	it("does not replay Set-Cookie header from cached response", async () => {
		const store = memoryStore();
		const app = new Hono();
		app.use("/api/*", idempotency({ store }));
		app.post("/api/with-cookie", (c) => {
			return new Response("ok", {
				status: 200,
				headers: {
					"Content-Type": "text/plain",
					"Set-Cookie": "session=abc123; Path=/; HttpOnly",
				},
			});
		});

		const key = "key-set-cookie";

		const res1 = await app.request("/api/with-cookie", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);
		expect(res1.headers.get("Set-Cookie")).toBe("session=abc123; Path=/; HttpOnly");

		// Replayed response must NOT include Set-Cookie
		const res2 = await app.request("/api/with-cookie", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
		expect(res2.headers.get("Set-Cookie")).toBeNull();
	});

	// Custom headerName
	describe("headerName", () => {
		it("uses custom header name for key extraction", async () => {
			const { app } = createApp({ headerName: "X-Request-Id" });
			const key = "key-custom-header";

			const res1 = await app.request("/api/text", {
				method: "POST",
				headers: { "X-Request-Id": key },
			});
			expect(res1.status).toBe(200);

			const res2 = await app.request("/api/text", {
				method: "POST",
				headers: { "X-Request-Id": key },
			});
			expect(res2.status).toBe(200);
			expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
		});

		it("ignores default Idempotency-Key when custom headerName is set", async () => {
			let callCount = 0;
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, headerName: "X-Request-Id" }));
			app.post("/api/counter", (c) => {
				callCount++;
				return c.json({ count: callCount });
			});

			// Default header ignored — each request is fresh
			const res1 = await app.request("/api/counter", {
				method: "POST",
				headers: { "Idempotency-Key": "key-ignored" },
			});
			const res2 = await app.request("/api/counter", {
				method: "POST",
				headers: { "Idempotency-Key": "key-ignored" },
			});

			expect(callCount).toBe(2);
			expect(res2.headers.get("Idempotency-Replayed")).toBeNull();
		});

		it("returns 400 for missing custom header when required", async () => {
			const { app } = createApp({ headerName: "X-Request-Id", required: true });

			const res = await app.request("/api/text", { method: "POST" });
			expect(res.status).toBe(400);
		});
	});

	// Boundary: maxKeyLength
	describe("maxKeyLength boundary values", () => {
		it("maxKeyLength: 1 accepts single-character key", async () => {
			const { app } = createApp({ maxKeyLength: 1 });

			const res = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": "x" },
			});
			expect(res.status).toBe(200);
		});

		it("maxKeyLength: 1 rejects two-character key", async () => {
			const { app } = createApp({ maxKeyLength: 1 });

			const res = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": "xx" },
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.code).toBe("KEY_TOO_LONG");
		});

		it("maxKeyLength: 0 rejects any non-empty key", async () => {
			const { app } = createApp({ maxKeyLength: 0 });

			const res = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": "a" },
			});
			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.detail).toContain("0");
		});
	});

	// Boundary: methods option
	describe("methods boundary values", () => {
		it("methods: [] skips all requests", async () => {
			let callCount = 0;
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, methods: [] }));
			app.post("/api/counter", (c) => {
				callCount++;
				return c.json({ count: callCount });
			});

			const key = "key-empty-methods";
			await app.request("/api/counter", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			await app.request("/api/counter", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});
			expect(callCount).toBe(2);
		});

		it("custom methods: ['PUT'] applies idempotency to PUT only", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, methods: ["PUT"] }));
			app.put("/api/resource", (c) => c.json({ updated: true }));
			app.post("/api/resource", (c) => c.json({ created: true }));

			const key = "key-put-method";

			// PUT is idempotent
			const res1 = await app.request("/api/resource", {
				method: "PUT",
				headers: { "Idempotency-Key": key },
			});
			expect(res1.status).toBe(200);

			const res2 = await app.request("/api/resource", {
				method: "PUT",
				headers: { "Idempotency-Key": key },
			});
			expect(res2.headers.get("Idempotency-Replayed")).toBe("true");

			// POST is not in methods list — passes through without idempotency
			let postCount = 0;
			const app2 = new Hono();
			app2.use("/api/*", idempotency({ store: memoryStore(), methods: ["PUT"] }));
			app2.post("/api/resource", (c) => {
				postCount++;
				return c.json({ count: postCount });
			});
			await app2.request("/api/resource", {
				method: "POST",
				headers: { "Idempotency-Key": "key-post-skip" },
			});
			await app2.request("/api/resource", {
				method: "POST",
				headers: { "Idempotency-Key": "key-post-skip" },
			});
			expect(postCount).toBe(2);
		});
	});

	// Boundary: res.ok (status 200-299 cached, 300+ not cached)
	describe("response status boundary", () => {
		it("status 299 is cached (res.ok = true)", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store }));
			app.post("/api/status-299", (c) => new Response("edge", { status: 299 }));

			const key = "key-299";
			await app.request("/api/status-299", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});

			const storeKey = `POST:/api/status-299:${key}`;
			const record = await store.get(storeKey);
			expect(record?.status).toBe("completed");
			expect(record?.response).toBeDefined();
		});

		it("status 300 is not cached (res.ok = false)", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store }));
			app.post(
				"/api/status-300",
				(c) => new Response(null, { status: 300, headers: { Location: "/other" } }),
			);

			const key = "key-300";
			await app.request("/api/status-300", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});

			const storeKey = `POST:/api/status-300:${key}`;
			const record = await store.get(storeKey);
			expect(record).toBeUndefined();
		});

		it("status 200 is cached (lower bound)", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store }));
			app.post("/api/ok", (c) => c.text("ok"));

			const key = "key-200";
			await app.request("/api/ok", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});

			const storeKey = `POST:/api/ok:${key}`;
			const record = await store.get(storeKey);
			expect(record?.status).toBe("completed");
		});

		it("status 400 is not cached (client error)", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store }));
			app.post("/api/status-400", () => new Response("bad request", { status: 400 }));

			const key = "key-400";
			await app.request("/api/status-400", {
				method: "POST",
				headers: { "Idempotency-Key": key },
			});

			const storeKey = `POST:/api/status-400:${key}`;
			const record = await store.get(storeKey);
			expect(record).toBeUndefined();
		});
	});

	// Boundary: empty string cacheKeyPrefix
	it("empty string cacheKeyPrefix is treated as no prefix", async () => {
		const store = memoryStore();
		const { app } = createApp({ store, cacheKeyPrefix: "" });
		const key = "key-empty-prefix";

		await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});

		// Empty string is falsy → no prefix in store key
		const record = await store.get(`POST:/api/text:${encodeURIComponent(key)}`);
		expect(record?.status).toBe("completed");
	});

	// Boundary: completed record without response → corrupt record is deleted and re-executed
	it("completed record without response deletes corrupt record and re-executes", async () => {
		const store = memoryStore();
		const fixedFp = "fixed-fingerprint";
		const app = new Hono();
		app.use("/api/*", idempotency({ store, fingerprint: () => fixedFp }));
		app.post("/api/text", (c) => c.text("hello"));

		const key = "key-no-response";
		const storeKey = `POST:/api/text:${encodeURIComponent(key)}`;

		// Manually insert a completed record with matching fingerprint but no response
		await store.lock(storeKey, {
			key,
			fingerprint: fixedFp,
			status: "completed",
			createdAt: Date.now(),
		});

		// Corrupt record should be deleted and handler re-executed
		const res = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res.status).toBe(200);
		expect(await res.text()).toBe("hello");
	});

	// Edge case: special characters in idempotency key
	it("handles special characters in key correctly", async () => {
		const { app } = createApp();
		// Latin1-safe but includes characters that need encoding (colons, slashes, spaces)
		const key = "r\u00E9q/key:with spaces&special=chars";

		const res1 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);

		const res2 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
	});

	// Edge case: POST with empty body
	it("handles POST with empty body deterministically", async () => {
		const { app } = createApp();
		const key = "key-empty-body";

		const res1 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res1.status).toBe(200);

		// Same key, same empty body → replayed
		const res2 = await app.request("/api/text", {
			method: "POST",
			headers: { "Idempotency-Key": key },
		});
		expect(res2.status).toBe(200);
		expect(res2.headers.get("Idempotency-Replayed")).toBe("true");
	});

	// maxBodySize: rejects large bodies before fingerprinting
	describe("maxBodySize", () => {
		it("rejects request when Content-Length exceeds maxBodySize", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, maxBodySize: 100 }));
			app.post("/api/text", (c) => c.text("ok"));

			const res = await app.request("/api/text", {
				method: "POST",
				headers: {
					"Idempotency-Key": "key-body-too-large",
					"Content-Length": "200",
				},
				body: "x".repeat(200),
			});
			expect(res.status).toBe(413);
			const body = await res.json();
			expect(body.code).toBe("BODY_TOO_LARGE");
		});

		it("allows request when Content-Length is within maxBodySize", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, maxBodySize: 100 }));
			app.post("/api/text", (c) => c.text("ok"));

			const res = await app.request("/api/text", {
				method: "POST",
				headers: {
					"Idempotency-Key": "key-body-ok",
					"Content-Length": "50",
				},
				body: "x".repeat(50),
			});
			expect(res.status).toBe(200);
		});

		it("defaults to no limit when maxBodySize is not set", async () => {
			const { app } = createApp();

			const res = await app.request("/api/text", {
				method: "POST",
				headers: {
					"Idempotency-Key": "key-no-limit",
				},
				body: "x".repeat(10000),
			});
			expect(res.status).toBe(200);
		});

		it("rejects large body even when Content-Length header is missing", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, maxBodySize: 100 }));
			app.post("/api/text", (c) => c.text("ok"));

			const res = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": "key-no-cl-large" },
				body: "x".repeat(200),
			});
			expect(res.status).toBe(413);
			const body = await res.json();
			expect(body.code).toBe("BODY_TOO_LARGE");
		});

		it("allows small body when Content-Length header is missing", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, maxBodySize: 100 }));
			app.post("/api/text", (c) => c.text("ok"));

			const res = await app.request("/api/text", {
				method: "POST",
				headers: { "Idempotency-Key": "key-no-cl-small" },
				body: "x".repeat(50),
			});
			expect(res.status).toBe(200);
		});

		it("rejects request when Content-Length is negative", async () => {
			const store = memoryStore();
			const app = new Hono();
			app.use("/api/*", idempotency({ store, maxBodySize: 100 }));
			app.post("/api/text", (c) => c.text("ok"));

			const res = await app.request("/api/text", {
				method: "POST",
				headers: {
					"Idempotency-Key": "key-negative-cl",
					"Content-Length": "-1",
				},
				body: "x".repeat(200),
			});
			expect(res.status).toBe(413);
			const body = await res.json();
			expect(body.code).toBe("BODY_TOO_LARGE");
		});
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
