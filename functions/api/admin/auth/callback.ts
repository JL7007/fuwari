import type { AdminEnv, PagesContext } from "../../../_lib/env";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from "../../../_lib/guard";
import {
	clearCookie,
	cookie,
	errorResponse,
	HttpError,
	parseCookies,
} from "../../../_lib/http";
import {
	createSignedValue,
	randomToken,
	readSignedValue,
} from "../../../_lib/session";

const SESSION_LIFETIME = 12 * 60 * 60;
const OWNER_LOGIN = "JL7007";

const githubHeaders = {
	Accept: "application/vnd.github+json",
	"X-GitHub-Api-Version": "2022-11-28",
	"User-Agent": "fuwari-admin",
};

function addClearedStateCookie(response: Response): Response {
	const headers = new Headers(response.headers);
	headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
	headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
	headers.set("Cache-Control", "no-store");
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

function constantTimeEqual(left: string, right: string): boolean {
	const leftBytes = new TextEncoder().encode(left);
	const rightBytes = new TextEncoder().encode(right);
	const length = Math.max(leftBytes.length, rightBytes.length);
	let mismatch = leftBytes.length ^ rightBytes.length;
	for (let index = 0; index < length; index += 1) {
		mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
	}
	return mismatch === 0;
}

async function exchangeCode(code: string, env: AdminEnv): Promise<string> {
	const body = new URLSearchParams({
		client_id: env.GITHUB_OAUTH_CLIENT_ID,
		client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
		code,
	});
	const response = await fetch("https://github.com/login/oauth/access_token", {
		method: "POST",
		headers: {
			...githubHeaders,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		body,
	});
	if (!response.ok) throw new HttpError(502, "GitHub authentication failed");
	const data = (await response.json()) as {
		access_token?: unknown;
		error?: unknown;
	};
	if (typeof data.access_token !== "string" || !data.access_token) {
		throw new HttpError(502, "GitHub authentication failed");
	}
	return data.access_token;
}

async function githubLogin(accessToken: string): Promise<string> {
	const response = await fetch("https://api.github.com/user", {
		headers: {
			...githubHeaders,
			Authorization: `Bearer ${accessToken}`,
		},
	});
	if (!response.ok) throw new HttpError(502, "GitHub identity lookup failed");
	const data = (await response.json()) as { login?: unknown };
	if (typeof data.login !== "string" || !data.login) {
		throw new HttpError(502, "GitHub identity lookup failed");
	}
	return data.login;
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
	try {
		const url = new URL(context.request.url);
		const code = url.searchParams.get("code");
		const state = url.searchParams.get("state");
		const stateCookie = parseCookies(context.request).get(OAUTH_STATE_COOKIE);
		if (!code || !state || !stateCookie) {
			throw new HttpError(400, "Invalid OAuth state");
		}

		const statePayload = await readSignedValue(
			stateCookie,
			context.env.SESSION_SECRET,
		);
		if (!statePayload || !constantTimeEqual(statePayload.csrfToken, state)) {
			throw new HttpError(400, "Invalid OAuth state");
		}

		const accessToken = await exchangeCode(code, context.env);
		const login = await githubLogin(accessToken);
		if (login.toLowerCase() !== OWNER_LOGIN.toLowerCase()) {
			throw new HttpError(403, "Forbidden");
		}

		const now = Math.floor(Date.now() / 1000);
		const session = await createSignedValue(
			{
				login: OWNER_LOGIN,
				csrfToken: randomToken(32),
				sessionId: randomToken(32),
				issuedAt: now,
				expiresAt: now + SESSION_LIFETIME,
			},
			context.env.SESSION_SECRET,
		);
		const headers = new Headers({
			"Cache-Control": "no-store",
			Location: new URL("/admin", context.env.SITE_ORIGIN).toString(),
		});
		headers.append(
			"Set-Cookie",
			cookie(SESSION_COOKIE, session, {
				maxAge: SESSION_LIFETIME,
				httpOnly: true,
			}),
		);
		headers.append("Set-Cookie", clearCookie(OAUTH_STATE_COOKIE));
		return new Response(null, { status: 302, headers });
	} catch (error) {
		return addClearedStateCookie(errorResponse(error));
	}
}
