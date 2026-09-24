import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminEnv } from "../../functions/_lib/env";
import { requireAdmin, requireMutation } from "../../functions/_lib/guard";
import { assertAllowedOrigin } from "../../functions/_lib/http";
import {
	createSignedValue,
	type SessionPayload,
} from "../../functions/_lib/session";

const payload: SessionPayload = {
	login: "JL7007",
	csrfToken: "csrf-123",
	sessionId: "session-123",
	issuedAt: 1_790_000_000,
	expiresAt: 1_790_043_200,
};

const env = {
	SESSION_SECRET: "secret",
	SITE_ORIGIN: "https://fuwari-ad9.pages.dev",
} as AdminEnv;

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(1_790_000_100 * 1000);
});

afterEach(() => {
	vi.useRealTimers();
});

async function adminRequest(
	session: SessionPayload = payload,
	headers: Record<string, string> = {},
): Promise<Request> {
	const token = await createSignedValue(session, env.SESSION_SECRET);
	return new Request("https://fuwari-ad9.pages.dev/api/admin/posts", {
		method: "POST",
		headers: {
			Cookie: `fuwari_admin=${token}`,
			Origin: env.SITE_ORIGIN,
			"X-CSRF-Token": session.csrfToken,
			...headers,
		},
	});
}

describe("admin request guards", () => {
	it("accepts only the configured production origin for mutations", () => {
		expect(() =>
			assertAllowedOrigin(
				new Request("https://x/api", {
					method: "POST",
					headers: { Origin: "https://evil.example" },
				}),
				"https://fuwari-ad9.pages.dev",
			),
		).toThrow("Invalid origin");

		expect(() =>
			assertAllowedOrigin(
				new Request("https://x/api", {
					method: "POST",
					headers: { Origin: "https://fuwari-ad9.pages.dev" },
				}),
				"https://fuwari-ad9.pages.dev",
			),
		).not.toThrow();
	});

	it("rejects a mutation without its CSRF header", async () => {
		const request = await adminRequest(payload, { "X-CSRF-Token": "" });
		await expect(requireMutation(request, env)).rejects.toThrow(
			"Invalid CSRF token",
		);
	});

	it("rejects a valid session belonging to a non-owner", async () => {
		const request = await adminRequest({ ...payload, login: "someone-else" });
		await expect(requireAdmin(request, env)).rejects.toThrow("Forbidden");
	});

	it("accepts the owner case-insensitively", async () => {
		const request = await adminRequest({ ...payload, login: "jl7007" });
		await expect(requireMutation(request, env)).resolves.toMatchObject({
			login: "jl7007",
		});
	});
});
