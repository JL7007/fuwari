<script lang="ts">
export type UploadState =
	| "queued"
	| "uploading"
	| "completed"
	| "failed"
	| "cancelled";

export interface UploadItem {
	id: string;
	file: File;
	progress: number;
	state: UploadState;
	error?: string;
}

export let items: UploadItem[] = [];
export let onretry: (item: UploadItem) => void;
export let oncancel: (item: UploadItem) => void;

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
	return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function stateLabel(state: UploadState): string {
	return {
		queued: "等待上传",
		uploading: "上传中",
		completed: "已完成",
		failed: "上传失败",
		cancelled: "已取消",
	}[state];
}
</script>

{#if items.length > 0}
	<section class="upload-queue" aria-labelledby="upload-queue-title">
		<h3 id="upload-queue-title">上传任务</h3>
		{#each items as item (item.id)}
			<article class="upload-item">
				<div class="upload-item-header">
					<div>
						<strong title={item.file.name}>{item.file.name}</strong>
						<span>{formatSize(item.file.size)} · {stateLabel(item.state)}</span>
					</div>
					<span class="upload-percent">{Math.round(item.progress * 100)}%</span>
				</div>
				<div class="progress-track" role="progressbar" aria-label={`${item.file.name} 上传进度`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(item.progress * 100)}>
					<div class="progress-value" style={`width: ${Math.round(item.progress * 100)}%`}></div>
				</div>
				{#if item.error}<p class="inline-error">{item.error}</p>{/if}
				{#if item.state === "uploading" || item.state === "queued"}
					<button class="ghost compact" type="button" on:click={() => oncancel(item)}>取消</button>
				{:else if item.state === "failed" || item.state === "cancelled"}
					<button class="secondary compact" type="button" on:click={() => onretry(item)}>重试</button>
				{/if}
			</article>
		{/each}
	</section>
{/if}
