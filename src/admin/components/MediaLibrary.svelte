<script lang="ts">
import { onMount } from "svelte";
import { adminApi, uploadMedia } from "../api";
import type { MediaKind, MediaObject, PostDocument } from "../contracts";
import UploadQueue, { type UploadItem } from "./UploadQueue.svelte";

export let currentPost: PostDocument | null = null;
export let oninsert: (media: MediaObject) => void | Promise<void>;

type Filter = "all" | MediaKind;
type QueueItem = UploadItem & { controller: AbortController };

let filter: Filter = "all";
let objects: MediaObject[] = [];
let uploads: QueueItem[] = [];
let loading = true;
let loadingMore = false;
let cursor: string | undefined;
let truncated = false;
let dragActive = false;
let error = "";
let notice = "";
let fileInput: HTMLInputElement;

$: visibleObjects =
	filter === "all"
		? objects
		: objects.filter((object) => object.kind === filter);

onMount(() => {
	void loadMedia();
});

async function loadMedia(append = false) {
	if (append) loadingMore = true;
	else loading = true;
	error = "";
	try {
		const result = await adminApi.listMedia({
			cursor: append ? cursor : undefined,
		});
		objects = append
			? [
					...objects,
					...result.objects.filter(
						(item) => !objects.some((current) => current.key === item.key),
					),
				]
			: result.objects;
		cursor = result.cursor;
		truncated = result.truncated;
	} catch (caught) {
		error = caught instanceof Error ? caught.message : "媒体加载失败，请重试。";
	} finally {
		loading = false;
		loadingMore = false;
	}
}

function updateUpload(id: string, changes: Partial<QueueItem>) {
	uploads = uploads.map((item) =>
		item.id === id ? { ...item, ...changes } : item,
	);
}

async function runUpload(item: QueueItem) {
	updateUpload(item.id, { state: "uploading", progress: 0, error: undefined });
	error = "";
	try {
		const media = await uploadMedia(
			item.file,
			(progress) => updateUpload(item.id, { progress }),
			item.controller.signal,
		);
		updateUpload(item.id, { state: "completed", progress: 1 });
		objects = [media, ...objects.filter((object) => object.key !== media.key)];
		notice = `“${item.file.name}”上传完成。`;
	} catch (caught) {
		const cancelled = item.controller.signal.aborted;
		updateUpload(item.id, {
			state: cancelled ? "cancelled" : "failed",
			error: cancelled
				? undefined
				: caught instanceof Error
					? caught.message
					: "上传失败",
		});
	}
}

function addFiles(files: FileList | File[]) {
	for (const file of Array.from(files)) {
		const id = `${Date.now()}-${crypto.randomUUID()}`;
		const item: QueueItem = {
			id,
			file,
			progress: 0,
			state: "queued",
			controller: new AbortController(),
		};
		uploads = [...uploads, item];
		void runUpload(item);
	}
	if (fileInput) fileInput.value = "";
}

function cancelUpload(item: UploadItem) {
	uploads.find((candidate) => candidate.id === item.id)?.controller.abort();
}

function retryUpload(item: UploadItem) {
	const current = uploads.find((candidate) => candidate.id === item.id);
	if (!current) return;
	const retry = {
		...current,
		controller: new AbortController(),
		state: "queued" as const,
		progress: 0,
	};
	uploads = uploads.map((candidate) =>
		candidate.id === item.id ? retry : candidate,
	);
	void runUpload(retry);
}

async function copyUrl(media: MediaObject) {
	try {
		await navigator.clipboard.writeText(`${location.origin}${media.url}`);
		notice = "媒体地址已复制。";
	} catch {
		error = "无法复制地址，请在新窗口打开媒体后手动复制。";
	}
}

function finalFilename(media: MediaObject): string {
	return decodeURIComponent(media.key.split("/").at(-1) ?? media.key);
}

function isReferenced(media: MediaObject): boolean {
	return Boolean(
		currentPost &&
			(currentPost.image === media.url || currentPost.body.includes(media.url)),
	);
}

async function deleteObject(media: MediaObject) {
	const filename = finalFilename(media);
	const referenced = isReferenced(media);
	if (referenced) {
		const typed = window.prompt(
			`当前打开的文章正在引用“${filename}”。删除后文章中的媒体将无法显示。\n\n请输入完整文件名以确认删除：`,
		);
		if (typed !== filename) return;
	} else if (!window.confirm(`确定删除媒体“${filename}”吗？此操作无法撤销。`)) {
		return;
	}

	error = "";
	try {
		await adminApi.deleteMedia(media.key);
		objects = objects.filter((object) => object.key !== media.key);
		notice = `“${filename}”已删除。`;
	} catch (caught) {
		error = caught instanceof Error ? caught.message : "删除媒体失败，请重试。";
	}
}

function drop(event: DragEvent) {
	event.preventDefault();
	dragActive = false;
	if (event.dataTransfer?.files.length) addFiles(event.dataTransfer.files);
}

function formatSize(bytes: number): string {
	if (bytes < 1024 ** 2) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
</script>

<section class="panel media-library" aria-labelledby="media-title">
	<div class="panel-heading">
		<div>
			<p class="eyebrow">Cloudflare R2</p>
			<h2 id="media-title">媒体库</h2>
		</div>
		<button class="ghost compact" type="button" on:click={() => loadMedia()} disabled={loading}>刷新</button>
	</div>

	<button
		type="button"
		class:active={dragActive}
		class="drop-zone"
		on:click={() => fileInput.click()}
		on:dragenter|preventDefault={() => (dragActive = true)}
		on:dragover|preventDefault={() => (dragActive = true)}
		on:dragleave|preventDefault={() => (dragActive = false)}
		on:drop={drop}
	>
		<strong>拖放图片或视频到这里</strong>
		<span>或点击选择文件，单个文件最大 5 GB</span>
	</button>
	<input
		class="sr-only"
		bind:this={fileInput}
		type="file"
		multiple
		accept="image/jpeg,image/png,image/gif,image/webp,image/avif,image/svg+xml,video/mp4,video/webm,video/quicktime,video/x-m4v"
		on:change={(event) => {
			const input = event.currentTarget as HTMLInputElement;
			if (input.files) addFiles(input.files);
		}}
	/>

	<UploadQueue items={uploads} onretry={retryUpload} oncancel={cancelUpload} />

	{#if error}<p class="message error-message" role="alert">{error}</p>{/if}
	{#if notice}<p class="message success-message" role="status">{notice}</p>{/if}

	<div class="segmented-control" aria-label="筛选媒体">
		<button type="button" class:active={filter === "all"} on:click={() => (filter = "all")}>全部</button>
		<button type="button" class:active={filter === "image"} on:click={() => (filter = "image")}>图片</button>
		<button type="button" class:active={filter === "video"} on:click={() => (filter = "video")}>视频</button>
	</div>

	<div class="media-grid" aria-live="polite">
		{#if loading}
			<div class="empty-state"><strong>正在读取媒体库…</strong></div>
		{:else if visibleObjects.length === 0}
			<div class="empty-state">
				<strong>这里还没有{filter === "image" ? "图片" : filter === "video" ? "视频" : "媒体"}</strong>
				<span>上传后可以直接插入当前文章。</span>
			</div>
		{:else}
			{#each visibleObjects as media (media.key)}
				<article class="media-card">
					<div class="media-preview">
						{#if media.kind === "image"}
							<img src={media.url} alt="" loading="lazy" />
						{:else}
							<video src={media.url} preload="metadata" muted aria-label={finalFilename(media)}></video>
							<span class="video-badge">视频</span>
						{/if}
					</div>
					<div class="media-info">
						<strong title={finalFilename(media)}>{finalFilename(media)}</strong>
						<span>{formatSize(media.size)}</span>
						{#if isReferenced(media)}<span class="reference-warning">当前文章正在使用</span>{/if}
					</div>
					<div class="media-actions">
						<button class="ghost compact" type="button" on:click={() => copyUrl(media)}>复制地址</button>
						<button class="secondary compact" type="button" on:click={() => oninsert(media)} disabled={!currentPost}>插入文章</button>
						<button class="danger-link compact" type="button" on:click={() => deleteObject(media)}>删除</button>
					</div>
				</article>
			{/each}
		{/if}
	</div>
	{#if truncated}
		<div class="load-more-row">
			<button class="secondary" type="button" on:click={() => loadMedia(true)} disabled={loadingMore}>
				{loadingMore ? "加载中…" : "加载更多"}
			</button>
		</div>
	{/if}
</section>
