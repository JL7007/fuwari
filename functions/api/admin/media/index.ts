import type { MediaKind, MediaObject } from "../../../../src/admin/contracts";
import type { PagesContext } from "../../../_lib/env";
import { errorResponse, HttpError, json } from "../../../_lib/http";
import { requireAdmin } from "../../../_lib/guard";

function kindForKey(key: string): MediaKind | null {
	if (key.startsWith("images/")) return "image";
	if (key.startsWith("videos/")) return "video";
	return null;
}

export const onRequestGet = async (context: PagesContext): Promise<Response> => {
	try {
		await requireAdmin(context.request, context.env);
		const url = new URL(context.request.url);
		const kind = url.searchParams.get("kind");
		if (kind !== null && kind !== "image" && kind !== "video") {
			throw new HttpError(400, "Invalid media kind");
		}
		const prefix = kind === "image" ? "images/" : kind === "video" ? "videos/" : undefined;
		const result = await context.env.MEDIA_BUCKET.list({
			limit: 100,
			cursor: url.searchParams.get("cursor") ?? undefined,
			prefix,
			include: ["httpMetadata"],
		});
		const objects = result.objects.flatMap((object): MediaObject[] => {
			const objectKind = kindForKey(object.key);
			if (!objectKind) return [];
			return [
				{
					key: object.key,
					url: `/media/${object.key.split("/").map(encodeURIComponent).join("/")}`,
					kind: objectKind,
					contentType: object.httpMetadata?.contentType ?? "application/octet-stream",
					size: object.size,
					uploaded: object.uploaded.toISOString(),
					etag: object.etag,
				},
			];
		});
		return json({
			objects,
			cursor: result.truncated ? result.cursor : undefined,
			truncated: result.truncated,
		});
	} catch (error) {
		return errorResponse(error);
	}
};
