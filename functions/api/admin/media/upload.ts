import type { MediaObject } from "../../../../src/admin/contracts";
import type { PagesContext } from "../../../_lib/env";
import { errorResponse, HttpError, json } from "../../../_lib/http";
import { requireMutation } from "../../../_lib/guard";
import {
	MediaValidationError,
	PART_SIZE,
	createMediaKey,
	validateMedia,
} from "../../../_lib/media";

export const onRequestPost = async (context: PagesContext): Promise<Response> => {
	try {
		await requireMutation(context.request, context.env);
		const encodedName = context.request.headers.get("X-File-Name") ?? "";
		let name: string;
		try {
			name = decodeURIComponent(encodedName);
		} catch {
			throw new HttpError(400, "X-File-Name must be URI encoded");
		}
		const contentType = context.request.headers.get("Content-Type") ?? "";
		const contentLength = Number(context.request.headers.get("Content-Length"));
		if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
			throw new HttpError(400, "A valid Content-Length is required");
		}
		const media = validateMedia(name, contentType, contentLength);
		if (contentLength > PART_SIZE || media.multipart) {
			throw new HttpError(400, "Files larger than 20 MB require multipart upload");
		}

		const bytes = await context.request.arrayBuffer();
		if (bytes.byteLength !== contentLength) {
			throw new HttpError(400, "Content-Length does not match the request body");
		}

		const key = createMediaKey(media.kind, media.safeName);
		const object = await context.env.MEDIA_BUCKET.put(key, bytes, {
			httpMetadata: { contentType: media.contentType },
		});
		const response: MediaObject = {
			key,
			url: `/media/${key.split("/").map(encodeURIComponent).join("/")}`,
			kind: media.kind,
			contentType: media.contentType,
			size: object.size,
			uploaded: object.uploaded.toISOString(),
			etag: object.etag,
		};
		return json(response, { status: 201 });
	} catch (error) {
		return errorResponse(
			error instanceof MediaValidationError ? new HttpError(400, error.message) : error,
		);
	}
};
