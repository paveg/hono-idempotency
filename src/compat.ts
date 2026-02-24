type HonoProblemDetails = typeof import("hono-problem-details");

let cached: HonoProblemDetails | null | undefined;

export async function getHonoProblemDetails(): Promise<HonoProblemDetails | null> {
	if (cached === undefined) {
		try {
			cached = await import("hono-problem-details");
		} catch {
			cached = null;
		}
	}
	return cached;
}
