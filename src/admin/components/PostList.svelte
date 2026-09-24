<script lang="ts">
import type { PostSummary } from "../contracts";

export let posts: PostSummary[] = [];
export let selectedSlug: string | null = null;
export let busy = false;
export let onopen: (post: PostSummary) => void | Promise<void>;
export let oncreate: () => void;
export let onduplicate: (post: PostSummary) => void | Promise<void>;
export let ondelete: (post: PostSummary) => void | Promise<void>;

let query = "";

$: normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
$: filtered = normalizedQuery
	? posts.filter((post) =>
			`${post.title} ${post.slug}`
				.toLocaleLowerCase("zh-CN")
				.includes(normalizedQuery),
		)
	: posts;
</script>

<section class="panel post-list" aria-labelledby="post-list-title">
	<div class="panel-heading">
		<div>
			<p class="eyebrow">内容</p>
			<h2 id="post-list-title">文章</h2>
		</div>
		<button class="primary compact" type="button" on:click={oncreate} disabled={busy}>新建</button>
	</div>

	<label class="search-field">
		<span class="sr-only">搜索文章标题或链接名</span>
		<input type="search" bind:value={query} placeholder="搜索标题或链接名" />
	</label>

	<div class="post-items" aria-live="polite">
		{#if filtered.length === 0}
			<div class="empty-state">
				<strong>{posts.length === 0 ? "还没有文章" : "没有匹配的文章"}</strong>
				<span>{posts.length === 0 ? "新建一篇草稿开始写作。" : "换一个关键词试试。"}</span>
			</div>
		{:else}
			{#each filtered as post (post.slug)}
				<article class:active={selectedSlug === post.slug} class="post-item">
					<button class="post-open" type="button" on:click={() => onopen(post)} disabled={busy}>
						<span class="post-title">{post.title || "无标题文章"}</span>
						<span class="post-meta">
							<code>{post.slug}</code>
							<span>{post.published}</span>
						</span>
						<span class:draft={post.draft} class:published={!post.draft} class="status-pill">
							{post.draft ? "草稿" : "已发布"}
						</span>
					</button>
					<div class="item-actions">
						<button type="button" class="ghost compact" on:click={() => onduplicate(post)} disabled={busy}>复制</button>
						<button type="button" class="danger-link compact" on:click={() => ondelete(post)} disabled={busy}>删除</button>
					</div>
				</article>
			{/each}
		{/if}
	</div>
</section>
