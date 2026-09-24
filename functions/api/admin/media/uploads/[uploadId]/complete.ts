import type { UploadedPartInput } from "../../../../../../src/admin/contracts";
import type { PagesContext } from "../../../../../_lib/env";
import { errorResponse, HttpError, json } from "../../../../../_lib/http";
import { requireMutation } from "../../../../../_lib/guard";
import {
	decodeKey,
	encodeKey,
	MediaValidationError,
	readMultipartUploadToken,
} from "../../../../../_lib/media";

interface CompleteUploadBody {
	key?: unknown;
	parts?: unknown;
}

function validateParts(value: unknown, expectedCount: number): UploadedPartInput[] {
	if (!Array.isArray(value) || value.length !== expectedCount) {
		throw new HttpError(400, "Multipart upload parts are required");
	}
	const parts = value.map((candidate): UploadedPartInput => {
		if (
			typeof candidate !== "object" ||
			candidate === null ||
			!Number.isInteger((candidate as UploadedPartInput).partNumber) ||
			(candidate as UploadedPartInput).partNumber < 1 ||
			(candidate as UploadedPartInput).partNumber > expectedCount ||
			typeof (candidate as UploadedPartInput).etag !== "string" ||
			!(candidate as UploadedPartInput).etag
		) {
			throw new HttpError(400, "Invalid multipart upload part");
		}
		return {
			partNumber: (candidate as UploadedPartInput).partNumber,
			etag: (candidate as UploadedPartInput).etag,
		};
	});
	parts.sort((a, b) => a.partNumber - b.partNumber);
	if (parts.some((part, index) => part.partNumber !== index + 1)) {
		throw new HttpError(400, "Multipart upload parts must be contiguous");
	}
	return parts;
}

export const onRequestPost = async (context: PagesContext<"uploadId">): Promise<Response> => {
	try {
		const session = await requireMutation(context.request, context.env);
		const uploadId = context.params.uploadId;
		if (Array.isArray(uploadId) || !uploadId) throw new HttpError(400, "Invalid upload ID");
		const body = (await context.request.json()) as CompleteUploadBody;
		if (typeof body.key !== "string") throw new HttpError(400, "A media key is required");
		const key = decodeKey(encodeKey(body.key));
		const descriptor = await readMultipartUploadToken(uploadId, context.env.SESSION_SECRET);
		if (!descriptor) throw new HttpError(400, "Invalid or expired upload ID");
		if (descriptor.sessionId !== session.sessionId) throw new HttpError(403, "Upload session mismatch");
		if (key !== descriptor.key) throw new HttpError(400, "Media key does not match upload ID");
		const parts = validateParts(body.parts, descriptor.partCount);
		const object = await context.env.MEDIA_BUCKET.resumeMultipartUpload(key, descriptor.r2UploadId).complete(parts);
		if (object.size !== descriptor.size) {
			await context.env.MEDIA_BUCKET.delete(key);
			throw new HttpError(400, "Completed upload size does not match the declared file size");
		}
		return json({
			key: object.key,
			url: `/media/${object.key.split("/").map(encodeURIComponent).join("/")}`,
			kind: object.key.startsWith("images/") ? "image" : "video",
			contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
			size: object.size,
			etag: object.etag,
			uploaded: object.uploaded.toISOString(),
		});
	} catch (error) {
		return errorResponse(
			error instanceof MediaValidationError ? new HttpError(400, error.message) : error,
		);
	}
};
