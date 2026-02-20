export async function generateFingerprint(
	method: string,
	path: string,
	body: string,
): Promise<string> {
	const data = `${method}:${path}:${body}`;
	const encoded = new TextEncoder().encode(data);
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
	const hashArray = new Uint8Array(hashBuffer);
	return Array.from(hashArray)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
