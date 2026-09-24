import type { PagesContext } from "../../../_lib/env";
import { requireMutation, SESSION_COOKIE } from "../../../_lib/guard";
import { clearCookie, errorResponse } from "../../../_lib/http";

export async function onRequestPost(context: PagesContext): Promise<Response> {
	try {
		await requireMutation(context.request, context.env);
		return new Response(null, {
			status: 204,
			headers: {
				"Cache-Control": "no-store",
				"Set-Cookie": clearCookie(SESSION_COOKIE),
			},
		});
	} catch (error) {
		return errorResponse(error);
	}
}
