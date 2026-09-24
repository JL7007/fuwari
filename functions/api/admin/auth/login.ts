import type { PagesContext } from "../../../_lib/env";
import { OAUTH_STATE_COOKIE } from "../../../_lib/guard";
import { cookie } from "../../../_lib/http";
import { createSignedValue, randomToken } from "../../../_lib/session";

const OAUTH_STATE_LIFETIME = 10 * 60;

export async function onRequestGet(context: PagesContext): Promise<Response> {
	const now = Math.floor(Date.now() / 1000);
	const state = randomToken(32);
	const signedState = await createSignedValue(
		{
			login: "oauth",
			csrfToken: state,
			sessionId: randomToken(32),
			issuedAt: now,
			expiresAt: now + OAUTH_STATE_LIFETIME,
		},
		context.env.SESSION_SECRET,
	);

	const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
	authorizeUrl.searchParams.set(
		"client_id",
		context.env.GITHUB_OAUTH_CLIENT_ID,
	);
	authorizeUrl.searchParams.set(
		"redirect_uri",
		`${context.env.SITE_ORIGIN.replace(/\/$/, "")}/api/admin/auth/callback`,
	);
	authorizeUrl.searchParams.set("scope", "read:user");
	authorizeUrl.searchParams.set("state", state);

	return new Response(null, {
		status: 302,
		headers: {
			"Cache-Control": "no-store",
			Location: authorizeUrl.toString(),
			"Set-Cookie": cookie(OAUTH_STATE_COOKIE, signedState, {
				maxAge: OAUTH_STATE_LIFETIME,
				httpOnly: true,
			}),
		},
	});
}
