const encoder = new TextEncoder();
const HEX_TABLE = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export async function generateFingerprint(
	method: string,
	path: string,
	body: string,
): Promise<string> {
	const data = `${method}:${path}:${body}`;
	const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
	const bytes = new Uint8Array(hashBuffer);
	let hex = "";
	for (let i = 0; i < bytes.length; i++) {
		hex += HEX_TABLE[bytes[i]];
	}
	return hex;
}
