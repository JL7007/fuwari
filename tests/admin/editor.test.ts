import { afterEach, describe, expect, it, vi } from "vitest";
import { adminApi, uploadMedia } from "../../src/admin/api";
import {
	insertAtSelection,
	insertImageMarkdown,
	insertVideoHtml,
} from "../../src/admin/editor";

describe("editor media insertion", () => {
	it("creates Markdown for an image", () => {
		expect(insertImageMarkdown("/media/images/a.webp", "Cover")).toBe(
			"![Cover](/media/images/a.webp)",
		);
	});

	it("creates safe video HTML", () => {
		expect(insertVideoHtml("/media/videos/a.mp4")).toBe(
			'<video controls preload="metadata" src="/media/videos/a.mp4"></video>',
		);
	});

	it("removes delimiters from media attributes", () => {
		expect(insertImageMarkdown("/media/a.webp", "[Cover]")).toBe(
			"![Cover](/media/a.webp)",
		);
		expect(insertVideoHtml('/media/a.mp4" onplay="bad')).toBe(
			'<video controls preload="metadata" src="/media/a.mp4 onplay=bad"></video>',
		);
	});

	it("replaces the selection and returns the collapsed cursor", () => {
		expect(insertAtSelection("before OLD after", "NEW", 7, 10)).toEqual({
			value: "before NEW after",
			selectionStart: 10,
			selectionEnd: 10,
		});
	});
});

const media = {
	key: "images/2026/09/a.webp",
	url: "/media/images/2026/09/a.webp",
	kind: "image" as const,
	contentType: "image/webp",
	size: 3,
	uploaded: "2026-09-24T00:00:00.000Z",
	etag: "etag",
};

function jsonResponse(value: unknown, status = 200): Response {
	return new Response(JSON.stringify(value), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

describe("admin uploads", () => {
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("attaches CSRF and safely encodes a Unicode filename", async () => {
		const fetchMock = vi.fn(
			async (
				input: RequestInfo | URL,
				init?: RequestInit,
			): Promise<Response> => {
				if (String(input).endsWith("/auth/session")) {
					return jsonResponse({
						authenticated: true,
						user: "JL7007",
						csrfToken: "csrf-123",
					});
				}
				const headers = new Headers(init?.headers);
				expect(headers.get("X-CSRF-Token")).toBe("csrf-123");
				expect(headers.get("X-File-Name")).toBe(
					encodeURIComponent("封面.webp"),
				);
				// Content-Length is a forbidden browser header and is synthesized by fetch.
				expect(headers.has("Content-Length")).toBe(false);
				expect(init?.credentials).toBe("same-origin");
				return jsonResponse(media, 201);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		await adminApi.session();
		const progress: number[] = [];
		const file = {
			name: "封面.webp",
			type: "image/webp",
			size: 3,
		} as File;
		await expect(
			uploadMedia(file, (value) => progress.push(value)),
		).resolves.toEqual(media);
		expect(progress).toEqual([0, 1]);
	});

	it("rejects files over 5 GB before any network activity", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const file = {
			name: "too-large.mp4",
			type: "video/mp4",
			size: 5 * 1024 * 1024 * 1024 + 1,
		} as File;

		await expect(uploadMedia(file)).rejects.toThrow("cannot exceed 5 GB");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("uploads one bounded part at a time and retries a failed part three times", async () => {
		vi.useFakeTimers();
		let firstPartAttempts = 0;
		const bodies: number[] = [];
		const fetchMock = vi.fn(
			async (
				input: RequestInfo | URL,
				init?: RequestInit,
			): Promise<Response> => {
				const url = String(input);
				if (url === "/api/admin/media/uploads") {
					return jsonResponse(
						{
							key: "videos/2026/09/a.mp4",
							uploadId: "upload-1",
							partSize: 20 * 1024 * 1024,
						},
						201,
					);
				}
				if (url.includes("/parts/1?")) {
					bodies.push((init?.body as Blob).size);
					firstPartAttempts += 1;
					return firstPartAttempts < 4
						? jsonResponse({ error: "temporary" }, 503)
						: jsonResponse({ partNumber: 1, etag: "one" });
				}
				if (url.includes("/parts/2?")) {
					bodies.push((init?.body as Blob).size);
					return jsonResponse({ partNumber: 2, etag: "two" });
				}
				if (url.endsWith("/complete")) {
					return jsonResponse({
						...media,
						kind: "video",
						contentType: "video/mp4",
					});
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const size = 20 * 1024 * 1024 + 7;
		const file = {
			name: "a.mp4",
			type: "video/mp4",
			size,
			slice(start: number, end: number) {
				return { size: end - start } as Blob;
			},
		} as File;
		const progress: number[] = [];
		const result = uploadMedia(file, (value) => progress.push(value));
		await vi.runAllTimersAsync();

		await expect(result).resolves.toMatchObject({ kind: "video" });
		expect(firstPartAttempts).toBe(4);
		expect(bodies).toEqual([
			20 * 1024 * 1024,
			20 * 1024 * 1024,
			20 * 1024 * 1024,
			20 * 1024 * 1024,
			7,
		]);
		expect(progress).toEqual([0, (20 * 1024 * 1024) / size, 1]);
	});

	it("cancels the active request and aborts its multipart upload", async () => {
		const controller = new AbortController();
		let markPartStarted: () => void = () => undefined;
		const partStarted = new Promise<void>((resolve) => {
			markPartStarted = resolve;
		});
		let multipartAborted = false;
		const fetchMock = vi.fn(
			async (
				input: RequestInfo | URL,
				init?: RequestInit,
			): Promise<Response> => {
				const url = String(input);
				if (url === "/api/admin/media/uploads") {
					return jsonResponse(
						{
							key: "videos/2026/09/a.mp4",
							uploadId: "upload-1",
							partSize: 20 * 1024 * 1024,
						},
						201,
					);
				}
				if (url.includes("/parts/1?")) {
					markPartStarted();
					return new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener(
							"abort",
							() => reject(init.signal?.reason),
							{ once: true },
						);
					});
				}
				if (init?.method === "DELETE") {
					multipartAborted = true;
					return new Response(null, { status: 204 });
				}
				throw new Error(`Unexpected request: ${url}`);
			},
		);
		vi.stubGlobal("fetch", fetchMock);

		const size = 20 * 1024 * 1024 + 1;
		const file = {
			name: "a.mp4",
			type: "video/mp4",
			size,
			slice(start: number, end: number) {
				return { size: end - start } as Blob;
			},
		} as File;
		const result = uploadMedia(file, undefined, controller.signal);
		await partStarted;
		controller.abort();

		await expect(result).rejects.toMatchObject({ name: "AbortError" });
		expect(multipartAborted).toBe(true);
	});
});
