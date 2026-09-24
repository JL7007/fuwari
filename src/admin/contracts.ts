export interface PostFields {
	title: string;
	published: string;
	updated?: string;
	description: string;
	image: string;
	tags: string[];
	category: string;
	draft: boolean;
	lang: string;
	body: string;
}

export interface PostDocument extends PostFields {
  slug: string;
  sha: string | null;
  sourcePath?: string;
}

export interface PostSummary {
  slug: string;
  sha: string;
  sourcePath?: string;
  title: string;
	published: string;
	draft: boolean;
}

export type MediaKind = "image" | "video";

export interface MediaObject {
	key: string;
	url: string;
	kind: MediaKind;
	contentType: string;
	size: number;
	uploaded: string;
	etag: string;
}

export interface UploadSession {
	key: string;
	uploadId: string;
	partSize: number;
}

export interface UploadedPartInput {
	partNumber: number;
	etag: string;
}

export interface DeploymentSummary {
	id: number;
	status: "queued" | "in_progress" | "completed";
	conclusion: string | null;
	htmlUrl: string;
	createdAt: string;
	headSha: string;
}

export interface SessionResponse {
	authenticated: boolean;
	user?: string;
	csrfToken?: string;
}

export interface ApiErrorBody {
	error: string;
	fields?: Record<string, string>;
}
