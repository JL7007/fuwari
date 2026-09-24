import { decodeKey, parseRange } from "../_lib/media";

const CACHE_CONTROL = "public, max-age=31536000, immutable";

function mediaHeaders(object: R2Object): Headers {
	const headers = new Headers();
	object.writeHttpMetadata(headers);
	headers.set("Accept-Ranges", "bytes");
	headers.set("Cache-Control", CACHE_CONTROL);
	headers.set("Content-Length", object.size.toString());
	headers.set("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
	headers.set("ETag", object.httpEtag);
	headers.set("Last-Modified", object.uploaded.toUTCString());
	if (
		object.key.toLowerCase().endsWith(".svg") ||
		object.httpMetadata?.contentType?.split(";", 1)[0].trim().toLowerCase() === "image/svg+xml"
	) {
		headers.set("Content-Security-Policy", "sandbox; default-src 'none'");
		headers.set("X-Content-Type-Options", "nosniff");
	}
	return headers;
}

function matchesEtag(header: string | null, etag: string): boolean {
	const normalize = (value: string) => value.trim().replace(/^W\//, "");
	return (
		header
			?.split(",")
			.some((candidate) => candidate.trim() === "*" || normalize(candidate) === normalize(etag)) ?? false
	);
}

function ifRangeMatches(header: string | null, object: R2Object): boolean {
	if (!header) return true;
	const value = header.trim();
	if (value.startsWith("W/")) return false;
	if (value.startsWith('"')) return value === object.httpEtag;
	const timestamp = Date.parse(value);
	if (Number.isNaN(timestamp)) return false;
	return Math.floor(object.uploaded.getTime() / 1000) <= Math.floor(timestamp / 1000);
}

export const onRequest: PagesFunction<import("../_lib/env").AdminEnv, "path"> = async (context) => {
	if (context.request.method !== "GET" && context.request.method !== "HEAD") {
		return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
	}

	let key: string;
	try {
		const rawPath = Array.isArray(context.params.path)
			? context.params.path.join("/")
			: context.params.path;
		if (!rawPath) throw new Error("Invalid media key");
		key = decodeKey(rawPath);
	} catch {
		return new Response("Not Found", { status: 404 });
	}

	const metadata = await context.env.MEDIA_BUCKET.head(key);
	if (!metadata) return new Response("Not Found", { status: 404 });
	const headers = mediaHeaders(metadata);
	if (matchesEtag(context.request.headers.get("If-None-Match"), metadata.httpEtag)) {
		headers.delete("Content-Length");
		return new Response(null, { status: 304, headers });
	}

	const requestedRange = context.request.headers.get("Range");
	const rangeHeader =
		requestedRange && !requestedRange.includes(",") && ifRangeMatches(context.request.headers.get("If-Range"), metadata)
			? requestedRange
			: null;
	let range: { offset: number; length: number } | undefined;
	if (rangeHeader) {
		try {
			range = parseRange(rangeHeader, metadata.size);
		} catch {
			headers.set("Content-Range", `bytes */${metadata.size}`);
			headers.set("Content-Length", "0");
			return new Response(null, { status: 416, headers });
		}
	}

	if (range) {
		headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
		headers.set("Content-Length", range.length.toString());
		if (context.request.method === "HEAD") return new Response(null, { status: 206, headers });
		const object = await context.env.MEDIA_BUCKET.get(key, { range });
		if (!object) return new Response("Not Found", { status: 404 });
		return new Response(object.body, { status: 206, headers });
	}

	if (context.request.method === "HEAD") return new Response(null, { status: 200, headers });
	const object = await context.env.MEDIA_BUCKET.get(key);
	if (!object) return new Response("Not Found", { status: 404 });
	return new Response(object.body, { status: 200, headers });
};
