import { describe, expect, it } from "vitest";
import type { PostDocument } from "../../src/admin/contracts";

describe("admin contracts", () => {
	it("represents a complete editable post", () => {
		const post: PostDocument = {
			slug: "hello-world",
			sha: "abc123",
			title: "Hello",
			published: "2026-09-24",
			updated: "2026-09-24",
			description: "First post",
			image: "/media/images/2026/09/a.webp",
			tags: ["Notes"],
			category: "General",
			draft: false,
			lang: "zh_CN",
			body: "Hello",
		};
		expect(post.slug).toBe("hello-world");
	});
});
