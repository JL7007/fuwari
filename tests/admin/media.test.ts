import { describe, expect, it, vi } from "vitest";
import {
	MAX_FILE_SIZE,
	MAX_MULTIPART_PARTS,
	PART_SIZE,
	createMultipartUploadToken,
	createMediaKey,
	decodeKey,
	encodeKey,
	expectedMultipartPartSize,
	parseRange,
	readMultipartUploadToken,
	validateMedia,
} from "../../functions/_lib/media";
import { onRequest as serveMedia } from "../../functions/media/[[path]]";
import { onRequestPut as uploadPart } from "../../functions/api/admin/media/uploads/[uploadId]/parts/[partNumber]";
import { onRequestPost as completeUpload } from "../../functions/api/admin/media/uploads/[uploadId]/complete";
import { createSignedValue } from "../../functions/_lib/session";

describe("media validation", () => {
	it("accepts approved image and video combinations", () => {
		expect(validateMedia("photo.webp", "image/webp", 1024)).toMatchObject({
			kind: "image",
			contentType: "image/webp",
			safeName: "photo.webp",
			multipart: false,
		});
		expect(validateMedia("movie.mp4", "video/mp4", 101 * 1024 * 1024).multipart).toBe(true);
	});

	it("normalizes names while retaining the validated extension", () => {
		expect(validateMedia("My Summer Photo!!.JPG", "image/jpeg", PART_SIZE).safeName).toBe(
			"my-summer-photo.jpg",
		);
	});

	it("rejects unapproved types, mismatches, and invalid sizes", () => {
		expect(() => validateMedia("payload.exe", "application/octet-stream", 1)).toThrow(
			"Unsupported media type",
		);
		expect(() => validateMedia("photo.jpg", "image/png", 1)).toThrow("Unsupported media type");
		expect(() => validateMedia("huge.mp4", "video/mp4", 5 * 1024 ** 3 + 1)).toThrow("5 GB");
		expect(() => validateMedia("empty.mp4", "video/mp4", 0)).toThrow("size");
	});

	it("creates dated, confined object keys", () => {
		const key = createMediaKey("video", "demo.mp4", new Date("2026-09-24T00:00:00Z"));
		expect(key).toMatch(/^videos\/2026\/09\/[0-9a-f-]+-demo\.mp4$/);
		expect(decodeKey(encodeKey(key))).toBe(key);
	});

	it("rejects decoded keys that could escape media prefixes", () => {
		for (const key of ["/images/a.webp", "images/../secret", "other/a.webp"]) {
			expect(() => decodeKey(encodeURIComponent(key))).toThrow("Invalid media key");
		}
	});

	it("exports the specified upload limits", () => {
		expect(PART_SIZE).toBe(20 * 1024 * 1024);
		expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024 * 1024);
		expect(MAX_MULTIPART_PARTS).toBe(256);
	});

	it("signs the declared multipart size, key, and owner session", async () => {
		const descriptor = {
			key: "videos/2026/09/demo.mp4",
			r2UploadId: "r2-upload-id",
			size: PART_SIZE + 1024,
			contentType: "video/mp4",
			sessionId: "owner-session",
			expiresAt: Math.floor(Date.now() / 1000) + 3600,
		};
		const token = await createMultipartUploadToken(descriptor, "secret");
		expect(await readMultipartUploadToken(token, "secret")).toMatchObject({
			...descriptor,
			partCount: 2,
		});
		expect(await readMultipartUploadToken(`${token}x`, "secret")).toBeNull();
		expect(await readMultipartUploadToken(token, "wrong-secret")).toBeNull();
	});

	it("derives exact contiguous multipart sizes from the signed declaration", () => {
		const descriptor = { size: PART_SIZE * 2 + 123, partCount: 3 };
		expect(expectedMultipartPartSize(descriptor, 1)).toBe(PART_SIZE);
		expect(expectedMultipartPartSize(descriptor, 2)).toBe(PART_SIZE);
		expect(expectedMultipartPartSize(descriptor, 3)).toBe(123);
		expect(() => expectedMultipartPartSize(descriptor, 4)).toThrow("Invalid part number");
	});
});

describe("byte ranges", () => {
	it("parses bounded and suffix ranges", () => {
		expect(parseRange("bytes=100-199", 1000)).toEqual({ offset: 100, length: 100 });
		expect(parseRange("bytes=-200", 1000)).toEqual({ offset: 800, length: 200 });
		expect(parseRange("bytes=900-", 1000)).toEqual({ offset: 900, length: 100 });
	});

	it("caps an end beyond the object size", () => {
		expect(parseRange("bytes=900-1100", 1000)).toEqual({ offset: 900, length: 100 });
	});

	it("rejects invalid and unsatisfiable ranges", () => {
		expect(() => parseRange("bytes=1000-1100", 1000)).toThrow("Unsatisfiable range");
		expect(() => parseRange("bytes=0-1,4-5", 1000)).toThrow("Invalid range");
		expect(() => parseRange("items=0-1", 1000)).toThrow("Invalid range");
		expect(() => parseRange("bytes=-0", 1000)).toThrow("Unsatisfiable range");
	});
});

describe("multipart endpoint integrity", () => {
	async function ownerUpload() {
		const now = Math.floor(Date.now() / 1000);
		const session = {
			login: "JL7007",
			csrfToken: "csrf-token",
			sessionId: "owner-session",
			issuedAt: now - 10,
			expiresAt: now + 3600,
		};
		const secret = "test-secret";
		const sessionToken = await createSignedValue(session, secret);
		const key = "videos/2026/09/demo.mp4";
		const uploadToken = await createMultipartUploadToken(
			{
				key,
				r2UploadId: "real-r2-id",
				size: PART_SIZE + 123,
				contentType: "video/mp4",
				sessionId: session.sessionId,
				expiresAt: session.expiresAt,
			},
			secret,
		);
		return {
			key,
			uploadToken,
			env: {
				SESSION_SECRET: secret,
				SITE_ORIGIN: "https://fuwari-ad9.pages.dev",
			},
			headers: {
				Origin: "https://fuwari-ad9.pages.dev",
				"X-CSRF-Token": session.csrfToken,
				Cookie: `fuwari_admin=${sessionToken}`,
			},
		};
	}

	it("rejects a missing part Content-Length before reading the body", async () => {
		const fixture = await ownerUpload();
		const request = new Request(
			`https://fuwari-ad9.pages.dev/api/admin/media/uploads/${fixture.uploadToken}/parts/1?key=${encodeKey(fixture.key)}`,
			{ method: "PUT", headers: fixture.headers },
		);
		const readBody = vi.spyOn(request, "arrayBuffer");
		const resumeMultipartUpload = vi.fn();
		const response = await uploadPart({
			request,
			params: { uploadId: fixture.uploadToken, partNumber: "1" },
			env: { ...fixture.env, MEDIA_BUCKET: { resumeMultipartUpload } },
		} as never);
		expect(response.status).toBe(411);
		expect(readBody).not.toHaveBeenCalled();
		expect(resumeMultipartUpload).not.toHaveBeenCalled();
	});

	it("deletes a completed object whose size differs from its signed declaration", async () => {
		const fixture = await ownerUpload();
		const complete = vi.fn(async () => ({
			key: fixture.key,
			size: PART_SIZE,
			etag: "etag",
			uploaded: new Date(),
			httpMetadata: { contentType: "video/mp4" },
		}));
		const deleteObject = vi.fn(async () => undefined);
		const request = new Request(
			`https://fuwari-ad9.pages.dev/api/admin/media/uploads/${fixture.uploadToken}/complete`,
			{
				method: "POST",
				headers: { ...fixture.headers, "Content-Type": "application/json" },
				body: JSON.stringify({
					key: fixture.key,
					parts: [
						{ partNumber: 1, etag: "part-1" },
						{ partNumber: 2, etag: "part-2" },
					],
				}),
			},
		);
		const response = await completeUpload({
			request,
			params: { uploadId: fixture.uploadToken },
			env: {
				...fixture.env,
				MEDIA_BUCKET: {
					resumeMultipartUpload: vi.fn(() => ({ complete })),
					delete: deleteObject,
				},
			},
		} as never);
		expect(response.status).toBe(400);
		expect(deleteObject).toHaveBeenCalledWith(fixture.key);
	});
});

describe("public media delivery", () => {
	function contextFor(
		request: Request,
		options: { key?: string; contentType?: string } = {},
	) {
		const key = options.key ?? "videos/2026/09/demo.mp4";
		const contentType = options.contentType ?? "video/mp4";
		const metadata = {
			key,
			size: 1000,
			etag: "etag-value",
			httpEtag: '"etag-value"',
			uploaded: new Date("2026-09-24T00:00:00Z"),
			httpMetadata: { contentType },
			writeHttpMetadata(headers: Headers) {
				headers.set("Content-Type", contentType);
			},
		};
		const get = vi.fn(async () => ({
			...metadata,
			body: new Blob([new Uint8Array(100)]).stream(),
		}));
		return {
			context: {
				request,
				params: { path: key.split("/") },
				env: {
					MEDIA_BUCKET: { head: vi.fn(async () => metadata), get },
				},
			} as never,
			get,
		};
	}

	it("serves a valid byte range with seekable response headers", async () => {
		const { context, get } = contextFor(
			new Request("https://example.test/media/videos/2026/09/demo.mp4", {
				headers: { Range: "bytes=100-199" },
			}),
		);
		const response = await serveMedia(context);
		expect(response.status).toBe(206);
		expect(response.headers.get("Content-Range")).toBe("bytes 100-199/1000");
		expect(response.headers.get("Content-Length")).toBe("100");
		expect(response.headers.get("Accept-Ranges")).toBe("bytes");
		expect(get).toHaveBeenCalledWith("videos/2026/09/demo.mp4", {
			range: { offset: 100, length: 100 },
		});
	});

	it("returns 416 without reading an unsatisfiable range", async () => {
		const { context, get } = contextFor(
			new Request("https://example.test/media/videos/2026/09/demo.mp4", {
				headers: { Range: "bytes=1000-1100" },
			}),
		);
		const response = await serveMedia(context);
		expect(response.status).toBe(416);
		expect(response.headers.get("Content-Range")).toBe("bytes */1000");
		expect(get).not.toHaveBeenCalled();
	});

	it("honors weak If-None-Match validators", async () => {
		const { context, get } = contextFor(
			new Request("https://example.test/media/videos/2026/09/demo.mp4", {
				headers: { "If-None-Match": 'W/"etag-value"' },
			}),
		);
		const response = await serveMedia(context);
		expect(response.status).toBe(304);
		expect(get).not.toHaveBeenCalled();
	});

	it("sandboxes same-origin SVG documents", async () => {
		const { context } = contextFor(
			new Request("https://example.test/media/images/2026/09/vector.svg", { method: "HEAD" }),
			{ key: "images/2026/09/vector.svg", contentType: "image/svg+xml" },
		);
		const response = await serveMedia(context);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Security-Policy")).toBe("sandbox; default-src 'none'");
		expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
	});

	it("uses a range only when If-Range matches the current validator", async () => {
		const matching = contextFor(
			new Request("https://example.test/media/videos/2026/09/demo.mp4", {
				headers: { Range: "bytes=0-99", "If-Range": '"etag-value"' },
			}),
		);
		expect((await serveMedia(matching.context)).status).toBe(206);
		expect(matching.get).toHaveBeenCalledWith("videos/2026/09/demo.mp4", {
			range: { offset: 0, length: 100 },
		});

		const stale = contextFor(
			new Request("https://example.test/media/videos/2026/09/demo.mp4", {
				headers: { Range: "bytes=0-99", "If-Range": '"old-etag"' },
			}),
		);
		expect((await serveMedia(stale.context)).status).toBe(200);
		expect(stale.get).toHaveBeenCalledWith("videos/2026/09/demo.mp4");
	});

	it("ignores unsupported multiple ranges and sends the full object", async () => {
		const { context, get } = contextFor(
			new Request("https://example.test/media/videos/2026/09/demo.mp4", {
				headers: { Range: "bytes=0-9,20-29" },
			}),
		);
		const response = await serveMedia(context);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Range")).toBeNull();
		expect(get).toHaveBeenCalledWith("videos/2026/09/demo.mp4");
	});
});
