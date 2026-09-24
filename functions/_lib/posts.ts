import YAML from "yaml";
import type { PostDocument, PostFields } from "../../src/admin/contracts";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSlug(slug: string): string {
	if (!slugPattern.test(slug)) throw new Error("Invalid slug");
	return slug;
}

export function postPath(slug: string): string {
	return `src/content/posts/${validateSlug(slug)}.md`;
}

function text(value: unknown, field: string, required = false): string {
	const result = typeof value === "string" ? value.trim() : "";
	if (required && !result) throw new Error(`${field} is required`);
	return result;
}

function isoDate(value: unknown, field: string, required = false): string {
	const result = text(value, field, required);
	if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result))
		throw new Error(`${field} must be YYYY-MM-DD`);
	return result;
}

export function validatePostFields(value: Partial<PostFields>): PostFields {
	return {
		title: text(value.title, "title", true),
		published: isoDate(value.published, "published", true),
		updated: isoDate(value.updated, "updated") || undefined,
		description: text(value.description, "description"),
		image: text(value.image, "image"),
		tags: Array.isArray(value.tags)
			? value.tags.map((tag) => text(tag, "tag", true))
			: [],
		category: text(value.category, "category"),
		draft: Boolean(value.draft),
		lang: text(value.lang, "lang"),
		body: typeof value.body === "string" ? value.body : "",
	};
}

export function parsePost(
	slug: string,
	sha: string,
	source: string,
): PostDocument {
	const match = source.match(
		/^---\r?\n([\s\S]*?)\r?\n---\r?\n(?:\r?\n)?([\s\S]*)$/,
	);
	if (!match) throw new Error("Post frontmatter is missing");
	const data = YAML.parse(match[1]) as Partial<PostFields>;
	return {
		slug: validateSlug(slug),
		sha,
		...validatePostFields({ ...data, body: match[2] }),
	};
}

export function serializePost(post: PostDocument): string {
	const fields = validatePostFields(post);
	const frontmatter: Record<string, unknown> = {
		title: fields.title,
		published: fields.published,
	};
	if (fields.updated) frontmatter.updated = fields.updated;
	if (fields.description) frontmatter.description = fields.description;
	if (fields.image) frontmatter.image = fields.image;
	frontmatter.tags = fields.tags;
	if (fields.category) frontmatter.category = fields.category;
	frontmatter.draft = fields.draft;
	if (fields.lang) frontmatter.lang = fields.lang;
	return `---\n${YAML.stringify(frontmatter).trimEnd()}\n---\n\n${fields.body.trimStart()}`;
}
