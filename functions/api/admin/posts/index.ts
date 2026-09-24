import type { PostDocument } from "../../../../src/admin/contracts";
import type { AdminEnv } from "../../../_lib/env";
import {
	createPost,
	GitConflictError,
	listPosts,
	type GitHubConfig,
} from "../../../_lib/github";
import { requireAdmin, requireMutation } from "../../../_lib/guard";
import { errorResponse, HttpError, json } from "../../../_lib/http";
import { validatePostFields, validateSlug } from "../../../_lib/posts";

function githubConfig(env: AdminEnv): GitHubConfig {
	return {
		owner: env.GITHUB_OWNER,
		repo: env.GITHUB_REPO,
		token: env.GITHUB_CONTENT_TOKEN,
	};
}

function postFromBody(value: unknown): PostDocument {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new HttpError(400, "Invalid request body");
	}
	const input = value as Record<string, unknown>;
	try {
		return {
			slug: validateSlug(typeof input.slug === "string" ? input.slug : ""),
			sha: null,
			...validatePostFields(input),
		};
	} catch (error) {
		throw new HttpError(
			400,
			error instanceof Error ? error.message : "Invalid post",
		);
	}
}

function routeError(error: unknown): Response {
	if (error instanceof GitConflictError) {
		return json({ error: error.message }, { status: 409 });
	}
	return errorResponse(error);
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
	try {
		await requireAdmin(request, env);
		return json({ posts: await listPosts(githubConfig(env)) });
	} catch (error) {
		return routeError(error);
	}
};

export const onRequestPost: PagesFunction<AdminEnv> = async ({
	request,
	env,
}) => {
	try {
		await requireMutation(request, env);
		const post = postFromBody(await request.json());
		const result = await createPost(githubConfig(env), post);
		return json(
			{
				post: { ...post, sha: result.sha },
				commitSha: result.commitSha,
			},
			{ status: 201 },
		);
	} catch (error) {
		return routeError(error);
	}
};
