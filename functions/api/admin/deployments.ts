import type { AdminEnv } from "../../_lib/env";
import { listDeployments, type GitHubConfig } from "../../_lib/github";
import { requireAdmin } from "../../_lib/guard";
import { errorResponse, json } from "../../_lib/http";

function githubConfig(env: AdminEnv): GitHubConfig {
	return {
		owner: env.GITHUB_OWNER,
		repo: env.GITHUB_REPO,
		token: env.GITHUB_CONTENT_TOKEN,
	};
}

export const onRequestGet: PagesFunction<AdminEnv> = async ({ request, env }) => {
	try {
		await requireAdmin(request, env);
		return json({ deployments: await listDeployments(githubConfig(env)) });
	} catch (error) {
		return errorResponse(error);
	}
};
