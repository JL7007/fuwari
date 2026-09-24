import type {
	ApiErrorBody,
	DeploymentSummary,
	MediaKind,
	MediaObject,
	PostDocument,
	PostSummary,
	SessionResponse,
	UploadedPartInput,
	UploadSession,
} from "./contracts";

const PART_SIZE = 20 * 1024 * 1024;
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;
const RETRY_DELAYS = [500, 1_500, 3_000] as const;

let csrfToken: string | undefined;

export class ApiError extends Error {
	readonly status: number;
	readonly fields?: Record<string, string>;

	constructor(
		status: number,
		message: string,
		fields?: Record<string, string>,
	) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.fields = fields;
	}

	static async fromResponse(response: Response): Promise<ApiError> {
		let body: ApiErrorBody | undefined;
		try {
			const candidate = (await response.json()) as Partial<ApiErrorBody>;
			if (typeof candidate.error === "string") {
				body = {
					error: candidate.error,
					fields:
						candidate.fields && typeof candidate.fields === "object"
							? candidate.fields
							: undefined,
				};
			}
		} catch {
			// Some edge failures (for example a proxy error) do not return JSON.
		}
		return new ApiError(
			response.status,
			body?.error ||
				response.statusText ||
				`Request failed (${response.status})`,
			body?.fields,
		);
	}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers = new Headers(init.headers);
	const method = (init.method ?? "GET").toUpperCase();
	if (csrfToken && method !== "GET" && method !== "HEAD") {
		headers.set("X-CSRF-Token", csrfToken);
	}
	if (init.body && typeof init.body === "string") {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(path, {
		...init,
		headers,
		credentials: "same-origin",
	});
	if (!response.ok) throw await ApiError.fromResponse(response);
	return response.status === 204
		? (undefined as T)
		: (response.json() as Promise<T>);
}

export interface PostMutationResult {
	post: PostDocument;
	commitSha: string;
}

export interface CommitResult {
	commitSha: string;
}

export interface MediaListResult {
	objects: MediaObject[];
	cursor?: string;
	truncated: boolean;
}

export interface MediaListOptions {
	kind?: MediaKind;
	cursor?: string;
}

export const adminApi = {
	async session(): Promise<SessionResponse> {
		const session = await request<SessionResponse>("/api/admin/auth/session");
		csrfToken = session.authenticated ? session.csrfToken : undefined;
		return session;
	},

	async logout(): Promise<void> {
		await request<void>("/api/admin/auth/logout", { method: "POST" });
		csrfToken = undefined;
	},

	async listPosts(): Promise<PostSummary[]> {
		return (await request<{ posts: PostSummary[] }>("/api/admin/posts")).posts;
	},

	async getPost(slug: string, sourcePath?: string): Promise<PostDocument> {
		const query = new URLSearchParams();
		if (sourcePath) query.set("sourcePath", sourcePath);
		const suffix = query.size > 0 ? `?${query.toString()}` : "";
		return (
			await request<{ post: PostDocument }>(
				`/api/admin/posts/${encodeURIComponent(slug)}${suffix}`,
			)
		).post;
	},

	async createPost(post: PostDocument): Promise<PostMutationResult> {
		return request<PostMutationResult>("/api/admin/posts", {
			method: "POST",
			body: JSON.stringify(post),
		});
	},

	async updatePost(
		originalSlug: string,
		post: PostDocument,
	): Promise<PostMutationResult> {
		return request<PostMutationResult>(
			`/api/admin/posts/${encodeURIComponent(originalSlug)}`,
			{
				method: "PUT",
				body: JSON.stringify(post),
			},
		);
	},

	async deletePost(
		slug: string,
		sha: string,
		sourcePath?: string,
	): Promise<CommitResult> {
		return request<CommitResult>(
			`/api/admin/posts/${encodeURIComponent(slug)}`,
			{
				method: "DELETE",
				body: JSON.stringify({ sha, sourcePath }),
			},
		);
	},

	async listMedia(options: MediaListOptions = {}): Promise<MediaListResult> {
		const query = new URLSearchParams();
		if (options.kind) query.set("kind", options.kind);
		if (options.cursor) query.set("cursor", options.cursor);
		const suffix = query.size > 0 ? `?${query.toString()}` : "";
		return request<MediaListResult>(`/api/admin/media${suffix}`);
	},

	async deleteMedia(key: string): Promise<void> {
		await request<void>(`/api/admin/media/object/${encodeURIComponent(key)}`, {
			method: "DELETE",
		});
	},

	async listDeployments(): Promise<DeploymentSummary[]> {
		return (
			await request<{ deployments: DeploymentSummary[] }>(
				"/api/admin/deployments",
			)
		).deployments;
	},
};

function abortError(signal: AbortSignal): Error {
	if (signal.reason instanceof Error) return signal.reason;
	return new DOMException("Upload cancelled", "AbortError");
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw abortError(signal);
}

function waitForRetry(delay: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) {
			reject(abortError(signal));
			return;
		}

		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", onAbort);
			resolve();
		}, delay);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(abortError(signal as AbortSignal));
		};
		signal?.addEventListener("abort", onAbort, { once: true });
	});
}

async function uploadPart(
	session: UploadSession,
	partNumber: number,
	body: Blob,
	signal?: AbortSignal,
): Promise<UploadedPartInput> {
	const uploadId = encodeURIComponent(session.uploadId);
	const key = encodeURIComponent(session.key);
	const path = `/api/admin/media/uploads/${uploadId}/parts/${partNumber}?key=${key}`;
	let retry = 0;

	while (true) {
		throwIfAborted(signal);
		try {
			return await request<UploadedPartInput>(path, {
				method: "PUT",
				headers: { "Content-Type": "application/octet-stream" },
				body,
				signal,
			});
		} catch (error) {
			throwIfAborted(signal);
			if (retry >= RETRY_DELAYS.length) throw error;
			await waitForRetry(RETRY_DELAYS[retry], signal);
			retry += 1;
		}
	}
}

async function abortMultipart(session: UploadSession): Promise<void> {
	const uploadId = encodeURIComponent(session.uploadId);
	const key = encodeURIComponent(session.key);
	try {
		await request<void>(`/api/admin/media/uploads/${uploadId}?key=${key}`, {
			method: "DELETE",
		});
	} catch {
		// Preserve the upload/cancellation error. R2 also expires unfinished uploads.
	}
}

export async function uploadMedia(
	file: File,
	onProgress: (progress: number) => void = () => undefined,
	signal?: AbortSignal,
): Promise<MediaObject> {
	if (file.size > MAX_FILE_SIZE) {
		throw new Error("Media files cannot exceed 5 GB");
	}
	throwIfAborted(signal);
	onProgress(0);

	if (file.size <= PART_SIZE) {
		const result = await request<MediaObject>("/api/admin/media/upload", {
			method: "POST",
			headers: {
				"Content-Type": file.type,
				// Header values are ByteStrings in browsers. Encoding keeps Unicode names valid.
				"X-File-Name": encodeURIComponent(file.name),
			},
			body: file,
			signal,
		});
		onProgress(1);
		return result;
	}

	let session: UploadSession | undefined;
	try {
		session = await request<UploadSession>("/api/admin/media/uploads", {
			method: "POST",
			body: JSON.stringify({
				name: file.name,
				contentType: file.type,
				size: file.size,
			}),
			signal,
		});
		throwIfAborted(signal);

		const partSize = session.partSize || PART_SIZE;
		if (partSize <= 0 || partSize > PART_SIZE) {
			throw new Error("The server returned an invalid multipart part size");
		}
		const uploadedParts: UploadedPartInput[] = [];
		let uploadedBytes = 0;
		for (let offset = 0, partNumber = 1; offset < file.size; partNumber += 1) {
			const end = Math.min(offset + partSize, file.size);
			const part = file.slice(offset, end);
			uploadedParts.push(await uploadPart(session, partNumber, part, signal));
			uploadedBytes += part.size;
			onProgress(uploadedBytes / file.size);
			offset = end;
		}

		uploadedParts.sort((a, b) => a.partNumber - b.partNumber);
		return await request<MediaObject>(
			`/api/admin/media/uploads/${encodeURIComponent(session.uploadId)}/complete`,
			{
				method: "POST",
				body: JSON.stringify({ key: session.key, parts: uploadedParts }),
				signal,
			},
		);
	} catch (error) {
		if (session) await abortMultipart(session);
		if (signal?.aborted) throw abortError(signal);
		throw error;
	}
}
