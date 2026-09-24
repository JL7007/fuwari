import type { AdminEnv } from "./env";
import { assertAllowedOrigin, HttpError, parseCookies } from "./http";
import { readSignedValue, type SessionPayload } from "./session";

export const SESSION_COOKIE = "fuwari_admin";
export const OAUTH_STATE_COOKIE = "fuwari_oauth_state";

const OWNER_LOGIN = "jl7007";

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

export async function requireAdmin(
	request: Request,
	env: AdminEnv,
): Promise<SessionPayload> {
	const token = parseCookies(request).get(SESSION_COOKIE);
	if (!token) throw new HttpError(401, "Authentication required");

	const session = await readSignedValue(token, env.SESSION_SECRET);
	if (!session) throw new HttpError(401, "Invalid or expired session");
	if (session.login.toLowerCase() !== OWNER_LOGIN) {
		throw new HttpError(403, "Forbidden");
	}
	return session;
}

export async function requireMutation(
	request: Request,
	env: AdminEnv,
): Promise<SessionPayload> {
	const session = await requireAdmin(request, env);
	assertAllowedOrigin(request, env.SITE_ORIGIN);
	const csrfToken = request.headers.get("X-CSRF-Token") ?? "";
	if (!constantTimeEqual(csrfToken, session.csrfToken)) {
		throw new HttpError(403, "Invalid CSRF token");
	}
	return session;
}
