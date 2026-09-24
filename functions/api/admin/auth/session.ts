import type { SessionResponse } from "../../../../src/admin/contracts";
import type { PagesContext } from "../../../_lib/env";
import { requireAdmin, SESSION_COOKIE } from "../../../_lib/guard";
import { clearCookie, json, parseCookies } from "../../../_lib/http";

export async function onRequestGet(context: PagesContext): Promise<Response> {
	const headers = new Headers({ "Cache-Control": "no-store" });
	try {
		const session = await requireAdmin(context.request, context.env);
		return json(
			{
				authenticated: true,
				user: "JL7007",
				csrfToken: session.csrfToken,
			} satisfies SessionResponse,
			{ headers },
		);
	} catch {
		if (parseCookies(context.request).has(SESSION_COOKIE)) {
			headers.append("Set-Cookie", clearCookie(SESSION_COOKIE));
		}
		return json({ authenticated: false } satisfies SessionResponse, {
			headers,
		});
	}
}
