import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEnv, PagesContext } from "../../functions/_lib/env";
import { OAUTH_STATE_COOKIE, SESSION_COOKIE } from "../../functions/_lib/guard";
import { parseCookies } from "../../functions/_lib/http";
import {
	createSignedValue,
	readSignedValue,
	type SessionPayload,
} from "../../functions/_lib/session";
import { onRequestGet as callback } from "../../functions/api/admin/auth/callback";
import { onRequestGet as login } from "../../functions/api/admin/auth/login";
import { onRequestPost as logout } from "../../functions/api/admin/auth/logout";
import { onRequestGet as session } from "../../functions/api/admin/auth/session";

const now = 1_790_000_100;
const env = {
	GITHUB_OAUTH_CLIENT_ID: "client-id",
	GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
	SESSION_SECRET: "secret",
	SITE_ORIGIN: "https://fuwari-ad9.pages.dev",
} as AdminEnv;

function context(request: Request): PagesContext {
	return {
		request,
		env,
		params: {},
		data: {},
		functionPath: "",
		waitUntil: vi.fn(),
		passThroughOnException: vi.fn(),
		next: vi.fn(),
	} as unknown as PagesContext;
}

async function ownerCookie(): Promise<string> {
	const payload: SessionPayload = {
		login: "JL7007",
		csrfToken: "csrf-123",
		sessionId: "session-123",
		issuedAt: now,
		expiresAt: now + 43_200,
	};
	return createSignedValue(payload, env.SESSION_SECRET);
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(now * 1000);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe("GitHub OAuth routes", () => {
	it("starts OAuth with a signed, ten-minute state cookie", async () => {
		const response = await login(
			context(new Request(`${env.SITE_ORIGIN}/api/admin/auth/login`)),
		);
		expect(response.status).toBe(302);
		const target = new URL(response.headers.get("Location") ?? "");
		expect(target.origin + target.pathname).toBe(
			"https://github.com/login/oauth/authorize",
		);
		expect(target.searchParams.get("client_id")).toBe("client-id");
		expect(target.searchParams.get("scope")).toBe("read:user");

		const setCookie = response.headers.get("Set-Cookie") ?? "";
		expect(setCookie).toContain(`${OAUTH_STATE_COOKIE}=`);
		expect(setCookie).toContain("Max-Age=600");
		expect(setCookie).toContain("HttpOnly");
		const cookieHeader = setCookie.split(";")[0];
		const signedState = parseCookies(
			new Request(env.SITE_ORIGIN, { headers: { Cookie: cookieHeader } }),
		).get(OAUTH_STATE_COOKIE);
		const statePayload = await readSignedValue(
			signedState ?? "",
			env.SESSION_SECRET,
			now,
		);
		expect(statePayload?.csrfToken).toBe(target.searchParams.get("state"));
		expect(statePayload?.expiresAt).toBe(now + 600);
	});

	it("rejects an invalid callback state and clears its cookie", async () => {
		const response = await callback(
			context(
				new Request(
					`${env.SITE_ORIGIN}/api/admin/auth/callback?code=code&state=wrong`,
				),
			),
		);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: "Invalid OAuth state" });
		expect(response.headers.get("Set-Cookie")).toContain(
			`${OAUTH_STATE_COOKIE}=;`,
		);
	});

	it("creates an owner-only session without exposing the OAuth token", async () => {
		const loginResponse = await login(
			context(new Request(`${env.SITE_ORIGIN}/api/admin/auth/login`)),
		);
		const loginCookie = (loginResponse.headers.get("Set-Cookie") ?? "").split(
			";",
		)[0];
		const state = new URL(
			loginResponse.headers.get("Location") ?? "",
		).searchParams.get("state");
		const fetchMock = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ access_token: "oauth-secret" }), {
					status: 200,
				}),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ login: "jl7007" }), { status: 200 }),
			);
		vi.stubGlobal("fetch", fetchMock);

		const response = await callback(
			context(
				new Request(
					`${env.SITE_ORIGIN}/api/admin/auth/callback?code=code&state=${state}`,
					{ headers: { Cookie: loginCookie } },
				),
			),
		);
		expect(response.status).toBe(302);
		expect(response.headers.get("Location")).toBe(`${env.SITE_ORIGIN}/admin`);
		const setCookie = response.headers.get("Set-Cookie") ?? "";
		expect(setCookie).toContain(`${SESSION_COOKIE}=`);
		expect(setCookie).toContain("Max-Age=43200");
		expect(setCookie).not.toContain("oauth-secret");

		for (const [, init] of fetchMock.mock.calls) {
			const headers = new Headers((init as RequestInit).headers);
			expect(headers.get("Accept")).toBe("application/vnd.github+json");
			expect(headers.get("X-GitHub-Api-Version")).toBe("2022-11-28");
			expect(headers.get("User-Agent")).toBe("fuwari-admin");
		}
	});

	it("rejects a non-owner without creating a session", async () => {
		const state = "state-123";
		const stateCookie = await createSignedValue(
			{
				login: "oauth",
				csrfToken: state,
				sessionId: "state-session",
				issuedAt: now,
				expiresAt: now + 600,
			},
			env.SESSION_SECRET,
		);
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ access_token: "oauth-secret" })),
				)
				.mockResolvedValueOnce(
					new Response(JSON.stringify({ login: "someone-else" })),
				),
		);
		const response = await callback(
			context(
				new Request(
					`${env.SITE_ORIGIN}/api/admin/auth/callback?code=code&state=${state}`,
					{ headers: { Cookie: `${OAUTH_STATE_COOKIE}=${stateCookie}` } },
				),
			),
		);
		expect(response.status).toBe(403);
		expect(response.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=;`);
	});
});

describe("session routes", () => {
	it("returns only public session data", async () => {
		const token = await ownerCookie();
		const response = await session(
			context(
				new Request(`${env.SITE_ORIGIN}/api/admin/auth/session`, {
					headers: { Cookie: `${SESSION_COOKIE}=${token}` },
				}),
			),
		);
		expect(await response.json()).toEqual({
			authenticated: true,
			user: "JL7007",
			csrfToken: "csrf-123",
		});
	});

	it("requires origin and CSRF before logging out", async () => {
		const token = await ownerCookie();
		const unauthorized = await logout(
			context(
				new Request(`${env.SITE_ORIGIN}/api/admin/auth/logout`, {
					method: "POST",
					headers: { Cookie: `${SESSION_COOKIE}=${token}` },
				}),
			),
		);
		expect(unauthorized.status).toBe(403);

		const response = await logout(
			context(
				new Request(`${env.SITE_ORIGIN}/api/admin/auth/logout`, {
					method: "POST",
					headers: {
						Cookie: `${SESSION_COOKIE}=${token}`,
						Origin: env.SITE_ORIGIN,
						"X-CSRF-Token": "csrf-123",
					},
				}),
			),
		);
		expect(response.status).toBe(204);
		expect(response.headers.get("Set-Cookie")).toContain(`${SESSION_COOKIE}=;`);
	});
});
