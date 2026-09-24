export interface AdminEnv {
	MEDIA_BUCKET: R2Bucket;
	GITHUB_OAUTH_CLIENT_ID: string;
	GITHUB_OAUTH_CLIENT_SECRET: string;
	GITHUB_CONTENT_TOKEN: string;
	SESSION_SECRET: string;
	SITE_ORIGIN: string;
	GITHUB_OWNER: string;
	GITHUB_REPO: string;
}

export type PagesContext<Params extends string = string> = EventContext<
	AdminEnv,
	Params,
	Record<string, unknown>
>;
