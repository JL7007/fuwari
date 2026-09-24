import type { ApiErrorBody } from "../../src/admin/contracts";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class HttpError extends Error {
	readonly status: number;
	readonly fields?: Record<string, string>;

	constructor(
		status: number,
		message: string,
		fields?: Record<string, string>,
	) {
		super(message);
		this.name = "HttpError";
		this.status = status;
		this.fields = fields;
	}
}

export function json(data: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set("Content-Type", "application/json; charset=utf-8");
	return new Response(JSON.stringify(data), { ...init, headers });
}

export function parseCookies(request: Request): Map<string, string> {
	const result = new Map<string, string>();
	const header = request.headers.get("Cookie");
	if (!header) return result;

	for (const part of header.split(";")) {
		const separator = part.indexOf("=");
		if (separator < 1) continue;
		const name = part.slice(0, separator).trim();
		const rawValue = part.slice(separator + 1).trim();
		try {
			result.set(name, decodeURIComponent(rawValue));
		} catch {
			result.set(name, rawValue);
		}
	}
	return result;
}

export function cookie(
	name: string,
	value: string,
	options: { maxAge: number; httpOnly: boolean },
): string {
	const attributes = [
		`${name}=${encodeURIComponent(value)}`,
		"Path=/",
		`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`,
		"Secure",
		"SameSite=Lax",
	];
	if (options.httpOnly) attributes.push("HttpOnly");
	return attributes.join("; ");
}

export function clearCookie(name: string): string {
	return `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax; HttpOnly`;
}

export function assertAllowedOrigin(request: Request, origin: string): void {
	if (!MUTATION_METHODS.has(request.method.toUpperCase())) return;

	const originHeader = request.headers.get("Origin");
	try {
		if (
			!originHeader ||
			new URL(originHeader).origin !== new URL(origin).origin
		) {
			throw new Error("Invalid origin");
		}
	} catch {
		throw new HttpError(403, "Invalid origin");
	}
}

export function errorResponse(error: unknown): Response {
	if (error instanceof HttpError) {
		const body: ApiErrorBody = { error: error.message };
		if (error.fields) body.fields = error.fields;
		const headers = new Headers();
		if (error.status === 401) {
			headers.append("Set-Cookie", clearCookie("fuwari_admin"));
		}
		return json(body, { status: error.status, headers });
	}

	if (error instanceof SyntaxError) {
		return json({ error: "Invalid request body" } satisfies ApiErrorBody, {
			status: 400,
		});
	}

	return json({ error: "Internal server error" } satisfies ApiErrorBody, {
		status: 500,
	});
}
