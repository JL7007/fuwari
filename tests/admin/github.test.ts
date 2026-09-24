import { afterEach, describe, expect, it, vi } from "vitest";
import type { PostDocument } from "../../src/admin/contracts";
import {
	GitConflictError,
	GitHubApiError,
	GitNotFoundError,
	createPost,
	getPost,
	listDeployments,
	listPosts,
	updatePost,
} from "../../functions/_lib/github";

const config = { owner: "JL7007", repo: "fuwari", token: "token-value" };

const post: PostDocument = {
	slug: "hello",
	sha: "old-sha",
	title: "你好世界",
	published: "2026-09-24",
	description: "中文摘要",
	image: "",
	tags: ["随笔"],
	category: "日常",
	draft: false,
	lang: "zh_CN",
	body: "这是中文正文。\n",
};

function requestFromFetch(input: RequestInfo | URL, init?: RequestInit): Request {
	return input instanceof Request ? input : new Request(input, init);
}

function fileResponse(slug: string, sha: string, source: string): Response {
	const bytes = new TextEncoder().encode(source);
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return Response.json({
		name: `${slug}.md`,
		path: `src/content/posts/${slug}.md`,
		sha,
		type: "file",
		encoding: "base64",
		content: btoa(binary),
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("GitHub post adapter", () => {
	it("updates a post with repository config, expected SHA, and UTF-8 base64", async () => {
		let captured: Request | undefined;
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				captured = requestFromFetch(input, init);
				return Response.json({
					content: { sha: "new-sha" },
					commit: { sha: "commit-sha" },
				});
			}),
		);

		await expect(updatePost(config, "hello", post)).resolves.toEqual({
			sha: "new-sha",
			commitSha: "commit-sha",
		});
		expect(captured).toBeDefined();
		const request = captured as Request;
		expect(request.url).toBe(
			"https://api.github.com/repos/JL7007/fuwari/contents/src/content/posts/hello.md",
		);
		expect(request.headers.get("authorization")).toBe("Bearer token-value");
		expect(request.headers.get("accept")).toBe("application/vnd.github+json");
		expect(request.headers.get("x-github-api-version")).toBe("2022-11-28");
		const body = JSON.parse(await request.text()) as Record<string, string>;
		expect(body).toMatchObject({
			message: "content: publish hello",
			branch: "main",
			sha: "old-sha",
		});
		const decoded = new TextDecoder().decode(
			Uint8Array.from(atob(body.content), (character) => character.charCodeAt(0)),
		);
		expect(decoded).toContain("title: 你好世界");
		expect(decoded).toContain("这是中文正文。");
	});

	it("round trips UTF-8 content returned by GitHub", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				fileResponse(
					"hello",
					"sha-1",
					`---\ntitle: 你好\npublished: 2026-09-24\ndescription: 摘要\nimage: ""\ntags: [随笔]\ncategory: 日常\ndraft: false\nlang: zh_CN\n---\n\n中文正文\n`,
				),
			),
		);

		const result = await getPost(config, "hello");
		expect(result).toMatchObject({
			title: "你好",
			description: "摘要",
			body: "中文正文\n",
			sha: "sha-1",
		});
	});

	it("maps GitHub conflicts and missing files to local errors", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ message: "conflict" }, { status: 409 })),
		);
		await expect(updatePost(config, "hello", post)).rejects.toBeInstanceOf(
			GitConflictError,
		);

		vi.stubGlobal(
			"fetch",
			vi.fn(async () => Response.json({ message: "missing" }, { status: 404 })),
		);
		await expect(getPost(config, "hello")).rejects.toBeInstanceOf(
			GitNotFoundError,
		);
	});

	it("does not misclassify unrelated GitHub 422 responses as edit conflicts", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({ message: "Validation failed: invalid branch" }, { status: 422 }),
			),
		);
		await expect(createPost(config, post)).rejects.toBeInstanceOf(GitHubApiError);
	});

	it("creates the destination before deleting the source during a rename", async () => {
		const methods: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const request = requestFromFetch(input, init);
				methods.push(`${request.method} ${new URL(request.url).pathname}`);
				if (request.method === "PUT") {
					return Response.json({
						content: { sha: "renamed-sha" },
						commit: { sha: "create-commit" },
					});
				}
				return Response.json({ commit: { sha: "delete-commit" } });
			}),
		);

		await updatePost(config, "hello", { ...post, slug: "renamed" });
		expect(methods).toEqual([
			"PUT /repos/JL7007/fuwari/contents/src/content/posts/renamed.md",
			"DELETE /repos/JL7007/fuwari/contents/src/content/posts/hello.md",
		]);
	});

	it("lists Markdown posts newest first", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				const request = requestFromFetch(input, init);
				if (request.url.includes("?ref=main")) {
					if (request.url.endsWith("/posts?ref=main")) {
						return Response.json([
							{ name: "older.md", path: "src/content/posts/older.md", sha: "1", type: "file" },
							{ name: "newer.md", path: "src/content/posts/newer.md", sha: "2", type: "file" },
							{ name: "note.txt", path: "z", sha: "3", type: "file" },
							{ name: "guide", path: "src/content/posts/guide", sha: "4", type: "dir" },
						]);
					}
					if (request.url.endsWith("/posts/guide?ref=main")) {
						return Response.json([
							{ name: "index.md", path: "src/content/posts/guide/index.md", sha: "5", type: "file" },
						]);
					}
					const slug = request.url.includes("newer.md")
						? "newer"
						: request.url.includes("guide/index.md")
							? "guide"
							: "older";
					const published = slug === "newer"
						? "2026-09-24"
						: slug === "guide"
							? "2026-01-01"
							: "2025-01-01";
					return fileResponse(
						slug,
						`${slug}-sha`,
						`---\ntitle: ${slug}\npublished: ${published}\ntags: []\ndraft: false\n---\n\nBody\n`,
					);
				}
				throw new Error(`Unexpected URL ${request.url}`);
			}),
		);

		await expect(listPosts(config)).resolves.toMatchObject([
			{ slug: "newer", published: "2026-09-24" },
			{ slug: "guide", sourcePath: "guide/index.md", published: "2026-01-01" },
			{ slug: "older", published: "2025-01-01" },
		]);
	});

	it("normalizes recent workflow runs", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(async () =>
				Response.json({
					workflow_runs: [
						{
							id: 7,
							status: "waiting",
							conclusion: null,
							html_url: "https://github.com/run/7",
							created_at: "2026-09-24T00:00:00Z",
							head_sha: "abc",
						},
					],
				}),
			),
		);

		await expect(listDeployments(config)).resolves.toEqual([
			{
				id: 7,
				status: "queued",
				conclusion: null,
				htmlUrl: "https://github.com/run/7",
				createdAt: "2026-09-24T00:00:00Z",
				headSha: "abc",
			},
		]);
	});

	it("does not send an expected SHA when creating a post", async () => {
		let body: Record<string, unknown> = {};
		vi.stubGlobal(
			"fetch",
			vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
				body = JSON.parse(await requestFromFetch(input, init).text());
				return Response.json({
					content: { sha: "created-sha" },
					commit: { sha: "created-commit" },
				});
			}),
		);
		await createPost(config, post);
		expect(body).not.toHaveProperty("sha");
	});
});
