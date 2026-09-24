import type { PostDocument } from "../../../../src/admin/contracts";
import type { AdminEnv } from "../../../_lib/env";
import {
	deletePost,
	getPost,
	GitConflictError,
	GitNotFoundError,
	type GitHubConfig,
	updatePost,
} from "../../../_lib/github";
import { requireAdmin, requireMutation } from "../../../_lib/guard";
import { errorResponse, HttpError, json } from "../../../_lib/http";
import {
	validatePostFields,
	validatePostSourcePath,
	validateSlug,
} from "../../../_lib/posts";

function githubConfig(env: AdminEnv): GitHubConfig {
	return {
		owner: env.GITHUB_OWNER,
		repo: env.GITHUB_REPO,
		token: env.GITHUB_CONTENT_TOKEN,
	};
}

function slugParameter(value: string | string[]): string {
	if (typeof value !== "string") throw new HttpError(400, "Invalid slug");
	try {
		return validateSlug(value);
	} catch {
		throw new HttpError(400, "Invalid slug");
	}
}

function objectBody(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new HttpError(400, "Invalid request body");
	}
	return value as Record<string, unknown>;
}

function updateFromBody(value: unknown): PostDocument {
	const input = objectBody(value);
	const sha = typeof input.sha === "string" ? input.sha.trim() : "";
	if (!sha) throw new HttpError(400, "Expected SHA is required");
	try {
		return {
			slug: validateSlug(typeof input.slug === "string" ? input.slug : ""),
			sha,
			...(typeof input.sourcePath === "string" && input.sourcePath
				? { sourcePath: validatePostSourcePath(input.sourcePath) }
				: {}),
			...validatePostFields(input),
		};
	} catch (error) {
		throw new HttpError(
			400,
			error instanceof Error ? error.message : "Invalid post",
		);
	}
}

function expectedDelete(value: unknown): { sha: string; sourcePath?: string } {
	const input = objectBody(value);
	const sha = typeof input.sha === "string" ? input.sha.trim() : "";
	if (!sha) throw new HttpError(400, "Expected SHA is required");
	return {
		sha,
		...(typeof input.sourcePath === "string" && input.sourcePath
			? { sourcePath: validatePostSourcePath(input.sourcePath) }
			: {}),
	};
}

function routeError(error: unknown): Response {
	if (error instanceof GitConflictError) {
		return json({ error: error.message }, { status: 409 });
	}
	if (error instanceof GitNotFoundError) {
		return json({ error: error.message }, { status: 404 });
	}
	return errorResponse(error);
}

export const onRequestGet: PagesFunction<AdminEnv, "slug"> = async ({
	request,
	env,
	params,
}) => {
	try {
		await requireAdmin(request, env);
		const slug = slugParameter(params.slug);
		const rawSourcePath = new URL(request.url).searchParams.get("sourcePath");
		const sourcePath = rawSourcePath
			? validatePostSourcePath(rawSourcePath)
			: undefined;
		return json({ post: await getPost(githubConfig(env), slug, sourcePath) });
	} catch (error) {
		return routeError(error);
	}
};

export const onRequestPut: PagesFunction<AdminEnv, "slug"> = async ({
	request,
	env,
	params,
}) => {
	try {
		await requireMutation(request, env);
		const originalSlug = slugParameter(params.slug);
		const post = updateFromBody(await request.json());
		const result = await updatePost(githubConfig(env), originalSlug, post);
		return json({
			post: { ...post, sha: result.sha },
			commitSha: result.commitSha,
		});
	} catch (error) {
		return routeError(error);
	}
};

export const onRequestDelete: PagesFunction<AdminEnv, "slug"> = async ({
	request,
	env,
	params,
}) => {
	try {
		await requireMutation(request, env);
		const slug = slugParameter(params.slug);
		const { sha, sourcePath } = expectedDelete(await request.json());
		return json(await deletePost(githubConfig(env), slug, sha, undefined, sourcePath));
	} catch (error) {
		return routeError(error);
	}
};
