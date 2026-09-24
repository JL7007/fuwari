import type { PagesContext } from "../../../../_lib/env";
import { errorResponse, HttpError } from "../../../../_lib/http";
import { requireMutation } from "../../../../_lib/guard";
import { decodeKey, MediaValidationError } from "../../../../_lib/media";

export const onRequestDelete = async (context: PagesContext<"encodedKey">): Promise<Response> => {
	try {
		await requireMutation(context.request, context.env);
		const encodedKey = context.params.encodedKey;
		if (Array.isArray(encodedKey)) throw new HttpError(400, "Invalid media key");
		await context.env.MEDIA_BUCKET.delete(decodeKey(encodedKey));
		return new Response(null, { status: 204 });
	} catch (error) {
		return errorResponse(
			error instanceof MediaValidationError ? new HttpError(400, error.message) : error,
		);
	}
};
