<script lang="ts">
import { onMount } from "svelte";
import { adminApi } from "./api";
import MediaLibrary from "./components/MediaLibrary.svelte";
import PostEditor from "./components/PostEditor.svelte";
import PostList from "./components/PostList.svelte";
import type {
	DeploymentSummary,
	MediaObject,
	PostDocument,
	PostSummary,
	SessionResponse,
} from "./contracts";

type View = "posts" | "editor" | "media";

let session: SessionResponse | null = null;
let posts: PostSummary[] = [];
let selected: PostDocument | null = null;
let view: View = "posts";
let busy = false;
let notice = "";
let error = "";
let deployments: DeploymentSummary[] = [];
let originalSlug: string | null = null;
let originalSourcePath: string | undefined;
let editorComponent: PostEditor | null = null;

$: latestDeployment = deployments[0] ?? null;
$: deploymentActive = deployments.some(
	(deployment) =>
		deployment.status === "queued" || deployment.status === "in_progress",
);

onMount(() => {
	void initialize();
	const poller = window.setInterval(() => {
		if (session?.authenticated && deploymentActive) void loadDeployments();
	}, 15_000);
	return () => window.clearInterval(poller);
});

async function initialize() {
	session = null;
	error = "";
	try {
		session = await adminApi.session();
		if (session.authenticated) {
			await Promise.all([loadPosts(), loadDeployments()]);
		}
	} catch (caught) {
		error = caught instanceof Error ? caught.message : "无法连接管理接口。";
	}
}

async function loadPosts() {
	posts = await adminApi.listPosts();
}

async function loadDeployments() {
	try {
		deployments = await adminApi.listDeployments();
	} catch (caught) {
		if (!error)
			error = caught instanceof Error ? caught.message : "无法读取部署状态。";
	}
}

function today(): string {
	const now = new Date();
	return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
		.toISOString()
		.slice(0, 10);
}

function emptyPost(): PostDocument {
	return {
		slug: "",
		sha: null,
		title: "",
		published: today(),
		updated: undefined,
		description: "",
		image: "",
		tags: [],
		category: "随笔",
		draft: true,
		lang: "zh_CN",
		body: "",
	};
}

function createPost() {
	selected = emptyPost();
	originalSlug = null;
	originalSourcePath = undefined;
	view = "editor";
	notice = "新草稿已建立；填写后请手动保存。";
	error = "";
}

async function openPost(summary: PostSummary) {
	busy = true;
	error = "";
	try {
		selected = await adminApi.getPost(summary.slug, summary.sourcePath);
		originalSlug = summary.slug;
		originalSourcePath = summary.sourcePath;
		view = "editor";
	} catch (caught) {
		error = caught instanceof Error ? caught.message : "文章加载失败。";
	} finally {
		busy = false;
	}
}

function uniqueCopySlug(slug: string): string {
	const used = new Set(posts.map((post) => post.slug));
	let candidate = `${slug}-copy`;
	let index = 2;
	while (used.has(candidate)) candidate = `${slug}-copy-${index++}`;
	return candidate;
}

async function duplicatePost(summary: PostSummary) {
	busy = true;
	error = "";
	try {
		const source = await adminApi.getPost(summary.slug, summary.sourcePath);
		selected = {
			...source,
			slug: uniqueCopySlug(source.slug),
			sha: null,
			sourcePath: undefined,
			title: `${source.title}（副本）`,
			draft: true,
			published: today(),
			updated: undefined,
			tags: [...source.tags],
		};
		originalSlug = null;
		originalSourcePath = undefined;
		view = "editor";
		notice = "副本尚未保存。";
	} catch (caught) {
		error = caught instanceof Error ? caught.message : "复制文章失败。";
	} finally {
		busy = false;
	}
}

async function deletePost(summary: PostSummary) {
	if (
		!window.confirm(
			`确定删除文章“${summary.title || summary.slug}”（${summary.slug}）吗？此操作无法撤销。`,
		)
	)
		return;
	busy = true;
	error = "";
	try {
		await adminApi.deletePost(summary.slug, summary.sha, summary.sourcePath);
		if (
			originalSlug === summary.slug &&
			originalSourcePath === summary.sourcePath
		) {
			selected = null;
			originalSlug = null;
			originalSourcePath = undefined;
		}
		await loadPosts();
		notice = `文章“${summary.title || summary.slug}”已删除，网站将自动重新部署。`;
		await loadDeployments();
	} catch (caught) {
		error = caught instanceof Error ? caught.message : "删除文章失败。";
	} finally {
		busy = false;
	}
}

async function savePost(post: PostDocument, publish: boolean) {
	busy = true;
	error = "";
	try {
		const result =
			post.sha && originalSlug
				? await adminApi.updatePost(originalSlug, post)
				: await adminApi.createPost(post);
		selected = result.post;
		originalSlug = result.post.slug;
		originalSourcePath = result.post.sourcePath;
		await loadPosts();
		notice = publish
			? "文章已提交发布，网站正在部署。"
			: "草稿已保存，网站正在同步。";
		await loadDeployments();
	} finally {
		busy = false;
	}
}

async function insertMedia(media: MediaObject) {
	if (!selected) {
		error = "请先打开或新建一篇文章。";
		return;
	}
	await editorComponent?.insertMedia(media);
	view = "editor";
	notice = "媒体已插入正文；请手动保存文章。";
}

async function logout() {
	busy = true;
	try {
		await adminApi.logout();
		window.location.assign("/admin");
	} catch (caught) {
		error = caught instanceof Error ? caught.message : "退出失败，请重试。";
		busy = false;
	}
}

function deploymentLabel(deployment: DeploymentSummary | null): string {
	if (!deployment) return "暂无部署记录";
	if (deployment.status === "queued") return "等待部署";
	if (deployment.status === "in_progress") return "正在部署";
	if (deployment.conclusion === "success") return "部署成功";
	if (deployment.conclusion === "failure") return "部署失败";
	return deployment.conclusion
		? `部署：${deployment.conclusion}`
		: "部署已结束";
}
</script>

<main class="admin-shell">
	{#if session === null}
		<section class="auth-screen" aria-live="polite">
			<div class="brand-mark">F</div>
			<h1>Fuwari 管理后台</h1>
			{#if error}
				<p class="message error-message" role="alert">{error}</p>
				<button class="secondary" type="button" on:click={initialize}>重新连接</button>
			{:else}
				<p>正在检查登录状态…</p>
			{/if}
		</section>
	{:else if !session.authenticated}
		<section class="auth-screen">
			<div class="brand-mark">F</div>
			<p class="eyebrow">仅限站点所有者</p>
			<h1>Fuwari 管理后台</h1>
			<p>登录后可以在同一页面编辑文章，并上传图片和大视频。</p>
			<a class="primary login-button" href="/api/admin/auth/login">使用 GitHub 登录</a>
		</section>
	{:else}
		<header class="topbar">
			<div class="topbar-brand">
				<div class="brand-mark small">F</div>
				<div><strong>Fuwari</strong><span>管理后台</span></div>
			</div>
			<div class="topbar-status">
				{#if latestDeployment?.htmlUrl}
					<a class:working={deploymentActive} class:failed={latestDeployment.conclusion === "failure"} class="deployment-status" href={latestDeployment.htmlUrl} target="_blank" rel="noreferrer">
						<span></span>{deploymentLabel(latestDeployment)}
					</a>
				{:else}
					<span class="deployment-status"><span></span>{deploymentLabel(latestDeployment)}</span>
				{/if}
				<span class="account-name">@{session.user}</span>
				<button class="ghost compact" type="button" on:click={logout} disabled={busy}>退出</button>
			</div>
		</header>

		<nav class="mobile-tabs" aria-label="后台页面">
			<button class:active={view === "posts"} type="button" on:click={() => (view = "posts")}>文章</button>
			<button class:active={view === "editor"} type="button" on:click={() => (view = "editor")}>编辑器</button>
			<button class:active={view === "media"} type="button" on:click={() => (view = "media")}>媒体</button>
		</nav>

		{#if error || notice}
			<div class="global-messages">
				{#if error}<p class="message error-message" role="alert">{error}</p>{/if}
				{#if notice}<p class="message success-message" role="status">{notice}</p>{/if}
			</div>
		{/if}

		<div class="admin-grid">
			<div class:hidden-mobile={view !== "posts"} class="posts-column">
				<PostList
					{posts}
					selectedSlug={originalSlug}
					{busy}
					onopen={openPost}
					oncreate={createPost}
					onduplicate={duplicatePost}
					ondelete={deletePost}
				/>
			</div>
			<div class:hidden-mobile={view !== "editor"} class="editor-column">
				<PostEditor bind:this={editorComponent} bind:post={selected} onSave={savePost} onOpenMedia={() => (view = "media")} />
			</div>
			<div class:hidden-mobile={view !== "media"} class="media-column">
				<MediaLibrary currentPost={selected} oninsert={insertMedia} />
			</div>
		</div>
	{/if}
</main>
