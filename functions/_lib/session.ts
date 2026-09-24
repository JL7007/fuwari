export interface SessionPayload {
	login: string;
	csrfToken: string;
	sessionId: string;
	issuedAt: number;
	expiresAt: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid base64url");
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	if (!secret) throw new Error("SESSION_SECRET is not configured");
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function isSessionPayload(value: unknown): value is SessionPayload {
	if (!value || typeof value !== "object") return false;
	const payload = value as Record<string, unknown>;
	return (
		typeof payload.login === "string" &&
		payload.login.length > 0 &&
		typeof payload.csrfToken === "string" &&
		payload.csrfToken.length > 0 &&
		typeof payload.sessionId === "string" &&
		payload.sessionId.length > 0 &&
		Number.isInteger(payload.issuedAt) &&
		Number.isInteger(payload.expiresAt) &&
		(payload.expiresAt as number) > (payload.issuedAt as number)
	);
}

export async function createSignedValue(
	payload: SessionPayload,
	secret: string,
): Promise<string> {
	if (!isSessionPayload(payload)) throw new Error("Invalid session payload");
	const encodedPayload = bytesToBase64Url(
		encoder.encode(JSON.stringify(payload)),
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		await hmacKey(secret),
		encoder.encode(encodedPayload),
	);
	return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function readSignedValue(
	token: string,
	secret: string,
	now = Math.floor(Date.now() / 1000),
): Promise<SessionPayload | null> {
	try {
		const segments = token.split(".");
		if (segments.length !== 2) return null;
		const [encodedPayload, encodedSignature] = segments;
		const valid = await crypto.subtle.verify(
			"HMAC",
			await hmacKey(secret),
			base64UrlToBytes(encodedSignature),
			encoder.encode(encodedPayload),
		);
		if (!valid) return null;

		const payload: unknown = JSON.parse(
			decoder.decode(base64UrlToBytes(encodedPayload)),
		);
		if (!isSessionPayload(payload) || payload.expiresAt <= now) return null;
		return payload;
	} catch {
		return null;
	}
}

export function randomToken(bytes = 32): string {
	if (!Number.isSafeInteger(bytes) || bytes < 1) {
		throw new Error("Token length must be a positive integer");
	}
	const random = new Uint8Array(bytes);
	crypto.getRandomValues(random);
	return bytesToBase64Url(random);
}
