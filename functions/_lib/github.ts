import type {
	DeploymentSummary,
	PostDocument,
	PostSummary,
} from "../../src/admin/contracts";
import {
	parsePost,
	postPath,
	postPathFromSource,
	serializePost,
	validatePostSourcePath,
	validateSlug,
} from "./posts";

const API_ROOT = "https://api.github.com";
const POSTS_DIRECTORY = "src/content/posts";
const API_VERSION = "2022-11-28";
const USER_AGENT = "fuwari-admin";

export class GitConflictError extends Error {
	constructor(message = "The GitHub resource has changed") {
		super(message);
		this.name = "GitConflictError";
	}
}

export class GitNotFoundError extends Error {
	constructor(message = "The GitHub resource was not found") {
		super(message);
		this.name = "GitNotFoundError";
	}
}

export class GitHubApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "GitHubApiError";
	}
}

export interface GitHubConfig {
	owner: string;
	repo: string;
	token: string;
}

interface GitHubContentEntry {
	name: string;
	path: string;
	sha: string;
	type: "file" | "dir" | "symlink" | "submodule";
}

interface GitHubFileContent extends GitHubContentEntry {
	content: string;
	encoding: string;
}

interface GitHubWriteResponse {
	content: { sha: string } | null;
	commit: { sha: string };
}

interface GitHubDeleteResponse {
	commit: { sha: string };
}

interface GitHubWorkflowRun {
	id: number;
	status: string | null;
	conclusion: string | null;
	html_url: string;
	created_at: string;
	head_sha: string;
}

function repositoryBase(config: GitHubConfig): string {
	return `${API_ROOT}/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
}

function githubHeaders(config: GitHubConfig): Headers {
	return new Headers({
		Accept: "application/vnd.github+json",
		Authorization: `Bearer ${config.token}`,
		"X-GitHub-Api-Version": API_VERSION,
		"User-Agent": USER_AGENT,
	});
}

async function responseMessage(response: Response): Promise<string> {
	try {
		const body = (await response.clone().json()) as { message?: unknown };
		if (typeof body.message === "string" && body.message.trim()) {
			return body.message;
		}
	} catch {
		// GitHub can return an empty or non-JSON response for upstream failures.
	}
	return `GitHub API request failed with status ${response.status}`;
}

async function githubRequest<T>(
	config: GitHubConfig,
	path: string,
	init: RequestInit = {},
): Promise<T> {
	const headers = githubHeaders(config);
	for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
	const response = await fetch(`${repositoryBase(config)}${path}`, {
		...init,
		headers,
	});

	if (response.status === 404) {
		throw new GitNotFoundError(await responseMessage(response));
	}
	if (response.status === 409) {
		throw new GitConflictError(await responseMessage(response));
	}
	if (!response.ok) {
		throw new GitHubApiError(response.status, await responseMessage(response));
	}
	return (await response.json()) as T;
}

function encodeUtf8Base64(value: string): string {
	const bytes = new TextEncoder().encode(value);
	let binary = "";
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
	}
	return btoa(binary);
}

function decodeUtf8Base64(value: string): string {
	const binary = atob(value.replace(/\s/g, ""));
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return new TextDecoder().decode(bytes);
}

async function mapConcurrent<T, R>(
	values: readonly T[],
	limit: number,
	mapper: (value: T) => Promise<R>,
): Promise<R[]> {
	const results = new Array<R>(values.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		while (nextIndex < values.length) {
			const index = nextIndex;
			nextIndex += 1;
			results[index] = await mapper(values[index]);
		}
	}

	await Promise.all(
		Array.from({ length: Math.min(limit, values.length) }, () => worker()),
	);
	return results;
}

async function listPostEntries(
	config: GitHubConfig,
	directory = POSTS_DIRECTORY,
): Promise<GitHubContentEntry[]> {
	const entries = await githubRequest<GitHubContentEntry[]>(
		config,
		`/contents/${directory}?ref=main`,
	);
	const files = entries.filter(
		(entry) => entry.type === "file" && entry.name.endsWith(".md"),
	);
	const nested = await mapConcurrent(
		entries.filter((entry) => entry.type === "dir"),
		4,
		(entry) => listPostEntries(config, entry.path),
	);
	return files.concat(nested.flat());
}

function relativePostSourcePath(path: string): string {
	const prefix = `${POSTS_DIRECTORY}/`;
	if (!path.startsWith(prefix)) throw new Error("Post path is outside the content directory");
	return validatePostSourcePath(path.slice(prefix.length));
}

function slugForSourcePath(sourcePath: string): string {
	const withoutExtension = sourcePath.endsWith("/index.md")
		? sourcePath.slice(0, -"/index.md".length)
		: sourcePath.slice(0, -".md".length);
	return validateSlug(withoutExtension.split("/").join("-"));
}

async function putPost(
	config: GitHubConfig,
	post: PostDocument,
	sha?: string,
	message = `content: publish ${post.slug}`,
	sourcePath?: string,
): Promise<{ sha: string; commitSha: string }> {
	const path = sourcePath
		? postPathFromSource(sourcePath)
		: postPath(post.slug);
	const body: Record<string, string> = {
		message,
		content: encodeUtf8Base64(serializePost(post)),
		branch: "main",
	};
	if (sha) body.sha = sha;

	let result: GitHubWriteResponse;
	try {
		result = await githubRequest<GitHubWriteResponse>(
			config,
			`/contents/${path}`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			},
		);
	} catch (error) {
		if (
			error instanceof GitHubApiError &&
			error.status === 422 &&
			/sha|already exists|does not match/i.test(error.message)
		) {
			throw new GitConflictError(error.message);
		}
		throw error;
	}
	if (!result.content) throw new Error("GitHub did not return the updated file");
	return { sha: result.content.sha, commitSha: result.commit.sha };
}

export async function listPosts(config: GitHubConfig): Promise<PostSummary[]> {
	const markdownFiles = await listPostEntries(config);
	const posts = await mapConcurrent(markdownFiles, 4, async (entry) => {
		const sourcePath = relativePostSourcePath(entry.path);
		const slug = slugForSourcePath(sourcePath);
		const post = await getPost(config, slug, sourcePath);
		return {
			slug: post.slug,
			sha: post.sha ?? entry.sha,
			sourcePath,
			title: post.title,
			published: post.published,
			draft: post.draft,
		} satisfies PostSummary;
	});
	return posts.sort(
		(left, right) =>
			right.published.localeCompare(left.published) ||
			left.slug.localeCompare(right.slug),
	);
}

export async function getPost(
	config: GitHubConfig,
	slug: string,
	sourcePath?: string,
): Promise<PostDocument> {
	const path = sourcePath
		? postPathFromSource(sourcePath)
		: postPath(slug);
	const result = await githubRequest<GitHubFileContent>(
		config,
		`/contents/${path}?ref=main`,
	);
	if (result.type !== "file" || result.encoding !== "base64") {
		throw new Error("GitHub returned an unsupported post representation");
	}
	return parsePost(
		slug,
		result.sha,
		decodeUtf8Base64(result.content),
		sourcePath,
	);
}

export async function createPost(
	config: GitHubConfig,
	post: PostDocument,
): Promise<{ sha: string; commitSha: string }> {
	validateSlug(post.slug);
	return putPost(config, { ...post, sha: null });
}

export async function updatePost(
	config: GitHubConfig,
	originalSlug: string,
	post: PostDocument,
): Promise<{ sha: string; commitSha: string }> {
	validateSlug(originalSlug);
	validateSlug(post.slug);
	if (!post.sha?.trim()) throw new GitConflictError("Expected SHA is required");

	if (post.slug === originalSlug) {
		return putPost(config, post, post.sha, undefined, post.sourcePath);
	}

	const created = await putPost(
		config,
		{ ...post, sha: null },
		undefined,
		`content: rename ${originalSlug} to ${post.slug}`,
	);
	try {
		await deletePost(
			config,
			originalSlug,
			post.sha,
			`content: rename ${originalSlug} to ${post.slug}`,
			post.sourcePath,
		);
	} catch (error) {
		// Avoid leaving a duplicate when deleting a stale source fails. Cleanup is
		// best-effort so the original conflict remains the error seen by the caller.
		try {
			await deletePost(
				config,
				post.slug,
				created.sha,
				`content: rollback rename ${originalSlug} to ${post.slug}`,
			);
		} catch {
			// A later edit can make rollback unsafe; never overwrite that edit.
		}
		throw error;
	}
	return created;
}

export async function deletePost(
	config: GitHubConfig,
	slug: string,
	sha: string,
	message = `content: delete ${slug}`,
	sourcePath?: string,
): Promise<{ commitSha: string }> {
	const path = sourcePath
		? postPathFromSource(sourcePath)
		: postPath(slug);
	if (!sha.trim()) throw new GitConflictError("Expected SHA is required");
	const result = await githubRequest<GitHubDeleteResponse>(
		config,
		`/contents/${path}`,
		{
			method: "DELETE",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message, sha, branch: "main" }),
		},
	);
	return { commitSha: result.commit.sha };
}

export async function listDeployments(
	config: GitHubConfig,
): Promise<DeploymentSummary[]> {
	const result = await githubRequest<{ workflow_runs: GitHubWorkflowRun[] }>(
		config,
		"/actions/runs?branch=main&per_page=10",
	);
	return result.workflow_runs.map((run) => ({
		id: run.id,
		status:
			run.status === "completed"
				? "completed"
				: run.status === "in_progress"
					? "in_progress"
					: "queued",
		conclusion: run.conclusion,
		htmlUrl: run.html_url,
		createdAt: run.created_at,
		headSha: run.head_sha,
	}));
}
