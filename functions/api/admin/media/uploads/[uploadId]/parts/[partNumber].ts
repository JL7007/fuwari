import type { PagesContext } from "../../../../../../_lib/env";
import { errorResponse, HttpError, json } from "../../../../../../_lib/http";
import { requireMutation } from "../../../../../../_lib/guard";
import {
	MediaValidationError,
	decodeKey,
	expectedMultipartPartSize,
	readMultipartUploadToken,
} from "../../../../../../_lib/media";

export const onRequestPut = async (
	context: PagesContext<"uploadId" | "partNumber">,
): Promise<Response> => {
	try {
		const session = await requireMutation(context.request, context.env);
		const uploadId = context.params.uploadId;
		const rawPartNumber = context.params.partNumber;
		if (Array.isArray(uploadId) || !uploadId || Array.isArray(rawPartNumber)) {
			throw new HttpError(400, "Invalid multipart upload route");
		}
		const descriptor = await readMultipartUploadToken(uploadId, context.env.SESSION_SECRET);
		if (!descriptor) throw new HttpError(400, "Invalid or expired upload ID");
		if (descriptor.sessionId !== session.sessionId) throw new HttpError(403, "Upload session mismatch");
		const partNumber = Number(rawPartNumber);
		const expectedLength = expectedMultipartPartSize(descriptor, partNumber);
		const encodedKey = new URL(context.request.url).searchParams.get("key");
		if (!encodedKey) throw new HttpError(400, "A media key is required");
		const key = decodeKey(encodedKey);
		if (key !== descriptor.key) throw new HttpError(400, "Media key does not match upload ID");

		const declaredLength = context.request.headers.get("Content-Length");
		if (declaredLength === null) throw new HttpError(411, "Content-Length is required");
		const length = Number(declaredLength);
		if (!Number.isSafeInteger(length) || length !== expectedLength) {
			throw new HttpError(400, `Part ${partNumber} must be exactly ${expectedLength} bytes`);
		}
		const bytes = await context.request.arrayBuffer();
		if (bytes.byteLength !== expectedLength) {
			throw new HttpError(400, "Content-Length does not match the request body");
		}

		const part = await context.env.MEDIA_BUCKET.resumeMultipartUpload(key, descriptor.r2UploadId).uploadPart(
			partNumber,
			bytes,
		);
		return json({ partNumber: part.partNumber, etag: part.etag });
	} catch (error) {
		return errorResponse(
			error instanceof MediaValidationError ? new HttpError(400, error.message) : error,
		);
	}
};
