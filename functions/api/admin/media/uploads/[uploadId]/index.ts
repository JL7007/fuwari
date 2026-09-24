import type { PagesContext } from "../../../../../_lib/env";
import { errorResponse, HttpError } from "../../../../../_lib/http";
import { requireMutation } from "../../../../../_lib/guard";
import { decodeKey, MediaValidationError, readMultipartUploadToken } from "../../../../../_lib/media";

export const onRequestDelete = async (context: PagesContext<"uploadId">): Promise<Response> => {
	try {
		const session = await requireMutation(context.request, context.env);
		const uploadId = context.params.uploadId;
		if (Array.isArray(uploadId) || !uploadId) throw new HttpError(400, "Invalid upload ID");
		const encodedKey = new URL(context.request.url).searchParams.get("key");
		if (!encodedKey) throw new HttpError(400, "A media key is required");
		const key = decodeKey(encodedKey);
		const descriptor = await readMultipartUploadToken(uploadId, context.env.SESSION_SECRET);
		if (!descriptor) throw new HttpError(400, "Invalid or expired upload ID");
		if (descriptor.sessionId !== session.sessionId) throw new HttpError(403, "Upload session mismatch");
		if (key !== descriptor.key) throw new HttpError(400, "Media key does not match upload ID");
		await context.env.MEDIA_BUCKET.resumeMultipartUpload(key, descriptor.r2UploadId).abort();
		return new Response(null, { status: 204 });
	} catch (error) {
		return errorResponse(
			error instanceof MediaValidationError ? new HttpError(400, error.message) : error,
		);
	}
};
