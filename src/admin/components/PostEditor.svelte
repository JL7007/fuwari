<script lang="ts">
import DOMPurify from "dompurify";
import { marked } from "marked";
import type { MediaObject, PostDocument } from "../contracts";
import {
	insertAtSelection,
	insertImageMarkdown,
	insertVideoHtml,
} from "../editor";

export let post: PostDocument | null = null;
export let onSave: (post: PostDocument, publish: boolean) => Promise<void>;
export let onOpenMedia: () => void;

let saving: "draft" | "publish" | null = null;
let saveError = "";
let saveNotice = "";
let bodyTextarea: HTMLTextAreaElement | null = null;
let selectionStart = 0;
let selectionEnd = 0;
let tagsText = "";
let tagsSource: PostDocument | null = null;

$: if (post !== tagsSource) {
	tagsSource = post;
	tagsText = post?.tags.join(", ") ?? "";
}
$: previewSource = post?.body ?? "";
$: previewHtml = DOMPurify.sanitize(marked.parse(previewSource) as string, {
	USE_PROFILES: { html: true },
});

function localDate(): string {
	const now = new Date();
	const offset = now.getTimezoneOffset() * 60_000;
	return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function syncTags() {
	if (!post) return;
	post.tags = tagsText
		.split(/[,，]/)
		.map((tag) => tag.trim())
		.filter(Boolean);
}

function rememberSelection() {
	if (!bodyTextarea) return;
	selectionStart = bodyTextarea.selectionStart;
	selectionEnd = bodyTextarea.selectionEnd;
}

export async function insertMedia(media: MediaObject) {
	if (!post) return;
	const filename = decodeURIComponent(media.key.split("/").at(-1) ?? "");
	const insertion =
		media.kind === "image"
			? insertImageMarkdown(media.url, filename.replace(/\.[^.]+$/, ""))
			: insertVideoHtml(media.url);
	const prefix =
		selectionStart > 0 && post.body[selectionStart - 1] !== "\n" ? "\n\n" : "";
	const suffix =
		selectionEnd < post.body.length && post.body[selectionEnd] !== "\n"
			? "\n\n"
			: "";
	const result = insertAtSelection(
		post.body,
		`${prefix}${insertion}${suffix}`,
		selectionStart,
		selectionEnd,
	);
	post = { ...post, body: result.value };
	selectionStart = result.selectionStart;
	selectionEnd = result.selectionEnd;
	await Promise.resolve();
	bodyTextarea?.focus();
	bodyTextarea?.setSelectionRange(selectionStart, selectionEnd);
}

async function save(publish: boolean) {
	if (!post || saving) return;
	syncTags();
	saveError = "";
	saveNotice = "";
	saving = publish ? "publish" : "draft";
	const next: PostDocument = {
		...post,
		tags: [...post.tags],
		draft: !publish,
		updated: publish ? localDate() : post.updated,
	};
	post = next;
	try {
		await onSave(next, publish);
		saveNotice = publish
			? "发布请求已提交，正在等待网站部署。"
			: "草稿已保存。";
	} catch (error) {
		const status =
			typeof error === "object" && error !== null && "status" in error
				? Number((error as { status: unknown }).status)
				: 0;
		saveError =
			status === 409
				? "文章已在其他位置更新，请重新加载后再保存。"
				: error instanceof Error
					? error.message
					: "保存失败，请稍后重试。";
	} finally {
		saving = null;
	}
}
</script>

<section class="panel editor-panel" aria-labelledby="editor-title">
	<div class="panel-heading editor-heading">
		<div>
			<p class="eyebrow">写作</p>
			<h2 id="editor-title">{post ? (post.title || "无标题文章") : "文章编辑器"}</h2>
		</div>
		{#if post}
			<span class:draft={post.draft} class:published={!post.draft} class="status-pill">
				{post.draft ? "草稿" : "已发布"}
			</span>
		{/if}
	</div>

	{#if !post}
		<div class="empty-state editor-empty">
			<strong>选择一篇文章，或新建草稿</strong>
			<span>这里会显示字段、Markdown 编辑器和实时预览。</span>
		</div>
	{:else}
		<form class="editor-form" on:submit|preventDefault={() => save(false)}>
			<div class="field-grid two-columns">
				<label class="field wide">
					<span>标题</span>
					<input bind:value={post.title} required placeholder="文章标题" />
				</label>
				<label class="field">
					<span>链接名</span>
					<input bind:value={post.slug} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="my-post" />
					<small>仅小写字母、数字和连字符</small>
				</label>
				<label class="field">
					<span>发布日期</span>
					<input type="date" bind:value={post.published} required />
				</label>
				<label class="field wide">
					<span>摘要</span>
					<textarea class="short-textarea" bind:value={post.description} required placeholder="用于文章列表和搜索结果的简短介绍"></textarea>
				</label>
				<label class="field">
					<span>分类</span>
					<input bind:value={post.category} required placeholder="随笔" />
				</label>
				<label class="field">
					<span>语言</span>
					<select bind:value={post.lang}>
						<option value="zh_CN">简体中文</option>
						<option value="zh_TW">繁體中文</option>
						<option value="en">English</option>
						<option value="ja">日本語</option>
					</select>
				</label>
				<label class="field wide">
					<span>标签</span>
					<input bind:value={tagsText} on:blur={syncTags} placeholder="生活, 摄影, 随笔" />
					<small>使用逗号分隔多个标签</small>
				</label>
				<label class="field wide">
					<span>封面图片</span>
					<div class="inline-field">
						<input bind:value={post.image} placeholder="/media/images/..." />
						<button type="button" class="secondary" on:click={onOpenMedia}>打开媒体库</button>
					</div>
				</label>
			</div>

			<div class="writing-grid">
				<label class="field writing-field">
					<span>Markdown 正文</span>
					<textarea
						class="markdown-editor"
						bind:this={bodyTextarea}
						bind:value={post.body}
						on:select={rememberSelection}
						on:click={rememberSelection}
						on:keyup={rememberSelection}
						placeholder="从这里开始写作……"
						spellcheck="true"
					></textarea>
				</label>
				<div class="field writing-field">
					<span>实时预览</span>
					<div class="markdown-preview" aria-live="polite">{@html previewHtml}</div>
				</div>
			</div>

			{#if saveError}<p class="message error-message" role="alert">{saveError}</p>{/if}
			{#if saveNotice}<p class="message success-message" role="status">{saveNotice}</p>{/if}

			<div class="editor-actions">
				<p class="autosave-note">不会自动保存。请在离开前手动保存。</p>
				<div>
					<button class="secondary" type="submit" disabled={saving !== null}>
						{saving === "draft" ? "保存中…" : "保存草稿"}
					</button>
					<button class="primary" type="button" on:click={() => save(true)} disabled={saving !== null}>
						{saving === "publish" ? "发布中…" : "发布"}
					</button>
				</div>
			</div>
		</form>
	{/if}
</section>
