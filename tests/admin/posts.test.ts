import { describe, expect, it } from "vitest";
import {
	parsePost,
	postPath,
	serializePost,
	validateSlug,
} from "../../functions/_lib/posts";

describe("post documents", () => {
	it("confines valid slugs to the posts directory", () => {
		expect(postPath("hello-world")).toBe("src/content/posts/hello-world.md");
		expect(() => validateSlug("../secret")).toThrow("Invalid slug");
		expect(() => validateSlug("Hello World")).toThrow("Invalid slug");
	});

	it("round trips Fuwari frontmatter", () => {
		const source =
			"---\ntitle: Hello\npublished: 2026-09-24\ndescription: Intro\nimage: /media/images/a.webp\ntags: [Notes]\ncategory: General\ndraft: false\nlang: zh_CN\n---\n\nBody\n";
		const parsed = parsePost("hello", "sha1", source);
		expect(parsed.title).toBe("Hello");
		expect(parsed.body).toBe("Body\n");
		expect(parsePost("hello", "sha2", serializePost(parsed)).tags).toEqual([
			"Notes",
		]);
	});

	it("rejects missing required fields", () => {
		expect(() =>
			parsePost("bad", "sha", "---\npublished: 2026-09-24\n---\n"),
		).toThrow("title");
	});
});
