import type { PagesContext } from "../../../../_lib/env";
import { errorResponse, HttpError, json } from "../../../../_lib/http";
import { requireMutation } from "../../../../_lib/guard";
import {
	MediaValidationError,
	PART_SIZE,
	createMultipartUploadToken,
	createMediaKey,
	validateMedia,
} from "../../../../_lib/media";

interface BeginUploadBody {
	name?: unknown;
	contentType?: unknown;
	size?: unknown;
}

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
	try {
		const session = await requireMutation(context.request, context.env);
		const body = (await context.request.json()) as BeginUploadBody;
		if (
			typeof body.name !== "string" ||
			typeof body.contentType !== "string" ||
			typeof body.size !== "number"
		) {
			throw new HttpError(400, "Invalid multipart upload request");
		}
		const media = validateMedia(body.name, body.contentType, body.size);
		if (!media.multipart) throw new HttpError(400, "Files at or below 20 MB use single upload");

		const key = createMediaKey(media.kind, media.safeName);
		const upload = await context.env.MEDIA_BUCKET.createMultipartUpload(key, {
			httpMetadata: { contentType: media.contentType },
		});
		try {
			const uploadId = await createMultipartUploadToken(
				{
					key,
					r2UploadId: upload.uploadId,
					size: body.size,
					contentType: media.contentType,
					sessionId: session.sessionId,
					expiresAt: session.expiresAt,
				},
				context.env.SESSION_SECRET,
			);
			return json({ key, uploadId, partSize: PART_SIZE }, { status: 201 });
		} catch (error) {
			await upload.abort();
			throw error;
		}
	} catch (error) {
		return errorResponse(
			error instanceof MediaValidationError ? new HttpError(400, error.message) : error,
		);
	}
};
