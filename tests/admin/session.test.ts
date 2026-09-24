import { describe, expect, it } from "vitest";
import {
	createSignedValue,
	randomToken,
	readSignedValue,
	type SessionPayload,
} from "../../functions/_lib/session";

const payload: SessionPayload = {
	login: "JL7007",
	csrfToken: "csrf-123",
	sessionId: "session-123",
	issuedAt: 1_790_000_000,
	expiresAt: 1_790_043_200,
};

describe("signed sessions", () => {
	it("accepts a valid unexpired session", async () => {
		const token = await createSignedValue(payload, "secret");
		expect((await readSignedValue(token, "secret", 1_790_000_100))?.login).toBe(
			"JL7007",
		);
	});

	it("rejects an expired session", async () => {
		const token = await createSignedValue(payload, "secret");
		expect(
			await readSignedValue(token, "secret", payload.expiresAt),
		).toBeNull();
	});

	it("rejects payload and signature tampering", async () => {
		const token = await createSignedValue(payload, "secret");
		const [encodedPayload, signature] = token.split(".");
		const first = encodedPayload[0] === "a" ? "b" : "a";
		const tamperedPayload = `${first}${encodedPayload.slice(1)}.${signature}`;
		expect(
			await readSignedValue(`${token}x`, "secret", 1_790_000_100),
		).toBeNull();
		expect(
			await readSignedValue(tamperedPayload, "secret", 1_790_000_100),
		).toBeNull();
	});

	it("rejects a token verified with the wrong secret", async () => {
		const token = await createSignedValue(payload, "secret");
		expect(await readSignedValue(token, "wrong", 1_790_000_100)).toBeNull();
	});

	it("creates URL-safe random values", () => {
		const token = randomToken(32);
		expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(token.length).toBeGreaterThanOrEqual(42);
	});
});
