export const PART_SIZE = 20 * 1024 * 1024;
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
export const MAX_MULTIPART_PARTS = 256;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface ValidatedMedia {
	kind: "image" | "video";
	contentType: string;
	safeName: string;
	multipart: boolean;
}

export class MediaValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MediaValidationError";
	}
}

export interface MultipartUploadDescriptor {
	key: string;
	r2UploadId: string;
	size: number;
	contentType: string;
	partCount: number;
	sessionId: string;
	expiresAt: number;
}

interface MediaType {
	kind: "image" | "video";
	contentTypes: readonly string[];
}

const MEDIA_TYPES: Readonly<Record<string, MediaType>> = {
	jpg: { kind: "image", contentTypes: ["image/jpeg"] },
	jpeg: { kind: "image", contentTypes: ["image/jpeg"] },
	png: { kind: "image", contentTypes: ["image/png"] },
	gif: { kind: "image", contentTypes: ["image/gif"] },
	webp: { kind: "image", contentTypes: ["image/webp"] },
	avif: { kind: "image", contentTypes: ["image/avif"] },
	svg: { kind: "image", contentTypes: ["image/svg+xml"] },
	mp4: { kind: "video", contentTypes: ["video/mp4"] },
	webm: { kind: "video", contentTypes: ["video/webm"] },
	mov: { kind: "video", contentTypes: ["video/quicktime"] },
	m4v: { kind: "video", contentTypes: ["video/x-m4v", "video/mp4"] },
};

function normalizeFilename(name: string, extension: string): string {
	const stem = name.slice(0, -(extension.length + 1));
	const safeStem = stem
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 120);
	return `${safeStem || "media"}.${extension}`;
}

export function validateMedia(name: string, contentType: string, size: number): ValidatedMedia {
	if (!Number.isSafeInteger(size) || size <= 0) throw new MediaValidationError("Invalid media size");
	if (size > MAX_FILE_SIZE) throw new MediaValidationError("Media files cannot exceed 5 GB");

	const filename = name.trim();
	const extensionMatch = filename.match(/\.([a-z0-9]+)$/i);
	const extension = extensionMatch?.[1].toLowerCase() ?? "";
	const mediaType = MEDIA_TYPES[extension];
	const normalizedContentType = contentType.trim().toLowerCase();
	if (!mediaType || !mediaType.contentTypes.includes(normalizedContentType)) {
		throw new MediaValidationError("Unsupported media type");
	}

	return {
		kind: mediaType.kind,
		contentType: normalizedContentType,
		safeName: normalizeFilename(filename, extension),
		multipart: size > PART_SIZE,
	};
}

export function createMediaKey(
	kind: "image" | "video",
	safeName: string,
	now = new Date(),
): string {
	const root = kind === "image" ? "images" : "videos";
	const year = now.getUTCFullYear().toString().padStart(4, "0");
	const month = (now.getUTCMonth() + 1).toString().padStart(2, "0");
	return `${root}/${year}/${month}/${crypto.randomUUID()}-${safeName}`;
}

export function encodeKey(key: string): string {
	return encodeURIComponent(assertMediaKey(key));
}

function assertMediaKey(key: string): string {
	if (
		key.startsWith("/") ||
		key.includes("..") ||
		key.includes("\\") ||
		(!key.startsWith("images/") && !key.startsWith("videos/")) ||
		key.includes("//") ||
		key.endsWith("/")
	) {
		throw new MediaValidationError("Invalid media key");
	}
	return key;
}

export function decodeKey(encoded: string): string {
	let key: string;
	try {
		key = decodeURIComponent(encoded);
	} catch {
		throw new MediaValidationError("Invalid media key");
	}
	return assertMediaKey(key);
}

export function parseRange(header: string, size: number): { offset: number; length: number } {
	if (!Number.isSafeInteger(size) || size <= 0) throw new MediaValidationError("Unsatisfiable range");
	const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
	if (!match || (!match[1] && !match[2])) throw new MediaValidationError("Invalid range");

	if (!match[1]) {
		const suffixLength = Number(match[2]);
		if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
			throw new MediaValidationError("Unsatisfiable range");
		}
		const length = Math.min(suffixLength, size);
		return { offset: size - length, length };
	}

	const offset = Number(match[1]);
	if (!Number.isSafeInteger(offset) || offset >= size) {
		throw new MediaValidationError("Unsatisfiable range");
	}
	const requestedEnd = match[2] ? Number(match[2]) : size - 1;
	if (!Number.isSafeInteger(requestedEnd) || requestedEnd < offset) {
		throw new MediaValidationError("Unsatisfiable range");
	}
	const end = Math.min(requestedEnd, size - 1);
	return { offset, length: end - offset + 1 };
}

function bytesToBase64Url(bytes: Uint8Array<ArrayBuffer>): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new MediaValidationError("Invalid upload ID");
	const padding = "=".repeat((4 - (value.length % 4)) % 4);
	const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/") + padding);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
}

async function uploadSigningKey(secret: string): Promise<CryptoKey> {
	if (!secret) throw new MediaValidationError("Upload signing secret is not configured");
	return crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign", "verify"],
	);
}

function validateMultipartDescriptor(value: unknown, now: number): MultipartUploadDescriptor {
	if (!value || typeof value !== "object") throw new MediaValidationError("Invalid upload ID");
	const descriptor = value as Record<string, unknown>;
	if (
		typeof descriptor.key !== "string" ||
		typeof descriptor.r2UploadId !== "string" ||
		!descriptor.r2UploadId ||
		typeof descriptor.contentType !== "string" ||
		typeof descriptor.sessionId !== "string" ||
		!descriptor.sessionId ||
		!Number.isSafeInteger(descriptor.size) ||
		!Number.isSafeInteger(descriptor.partCount) ||
		!Number.isSafeInteger(descriptor.expiresAt) ||
		(descriptor.expiresAt as number) <= now
	) {
		throw new MediaValidationError("Invalid or expired upload ID");
	}
	const key = assertMediaKey(descriptor.key);
	const size = descriptor.size as number;
	const media = validateMedia(key.slice(key.lastIndexOf("/") + 1), descriptor.contentType, size);
	const partCount = Math.ceil(size / PART_SIZE);
	if (!media.multipart || partCount > MAX_MULTIPART_PARTS || descriptor.partCount !== partCount) {
		throw new MediaValidationError("Invalid upload ID");
	}
	return {
		key,
		r2UploadId: descriptor.r2UploadId,
		size,
		contentType: media.contentType,
		partCount,
		sessionId: descriptor.sessionId,
		expiresAt: descriptor.expiresAt as number,
	};
}

export async function createMultipartUploadToken(
	descriptor: Omit<MultipartUploadDescriptor, "partCount">,
	secret: string,
): Promise<string> {
	const completeDescriptor = validateMultipartDescriptor(
		{ ...descriptor, partCount: Math.ceil(descriptor.size / PART_SIZE) },
		Math.floor(Date.now() / 1000) - 1,
	);
	const payload = bytesToBase64Url(encoder.encode(JSON.stringify(completeDescriptor)));
	const signature = await crypto.subtle.sign("HMAC", await uploadSigningKey(secret), encoder.encode(payload));
	return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function readMultipartUploadToken(
	token: string,
	secret: string,
	now = Math.floor(Date.now() / 1000),
): Promise<MultipartUploadDescriptor | null> {
	try {
		if (token.length > 4096) return null;
		const segments = token.split(".");
		if (segments.length !== 2) return null;
		const [payload, encodedSignature] = segments;
		const valid = await crypto.subtle.verify(
			"HMAC",
			await uploadSigningKey(secret),
			base64UrlToBytes(encodedSignature),
			encoder.encode(payload),
		);
		if (!valid) return null;
		return validateMultipartDescriptor(JSON.parse(decoder.decode(base64UrlToBytes(payload))), now);
	} catch {
		return null;
	}
}

export function expectedMultipartPartSize(
	descriptor: Pick<MultipartUploadDescriptor, "size" | "partCount">,
	partNumber: number,
): number {
	if (
		!Number.isInteger(partNumber) ||
		partNumber < 1 ||
		partNumber > descriptor.partCount ||
		descriptor.partCount !== Math.ceil(descriptor.size / PART_SIZE) ||
		descriptor.partCount > MAX_MULTIPART_PARTS
	) {
		throw new MediaValidationError("Invalid part number");
	}
	return partNumber === descriptor.partCount
		? descriptor.size - PART_SIZE * (descriptor.partCount - 1)
		: PART_SIZE;
}
