# Unified Blog Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a private `/admin` interface where GitHub user `JL7007` can manage Fuwari posts and upload images or videos up to 5 GB to Cloudflare R2, with automatic deployment to Cloudflare Pages.

**Architecture:** Keep the public Astro site static. Add a Svelte admin client, Cloudflare Pages Functions for GitHub OAuth/content operations and R2 multipart upload, an R2-backed `/media/*` delivery route, and a GitHub Actions workflow that deploys the existing Direct Upload Pages project after commits to `main`.

**Tech Stack:** Astro 5, Svelte 5, TypeScript, Cloudflare Pages Functions, Cloudflare R2, GitHub OAuth/Contents/Actions APIs, Vitest, pnpm, Wrangler 4.

## Global Constraints

- Production origin is exactly `https://fuwari-ad9.pages.dev`.
- Only GitHub login `JL7007`, compared case-insensitively, may receive an admin session.
- Post files are restricted to `src/content/posts/<slug>.md`; new slugs contain only lower-case letters, digits, and hyphens.
- Media is public under `/media/*`; upload, listing, and deletion APIs require an authenticated admin session.
- Allowed images: JPEG, PNG, GIF, WebP, AVIF, SVG. Allowed videos: MP4, WebM, MOV, M4V.
- Maximum file size is 5 GB. Files larger than 20 MB use 20 MB R2 multipart parts.
- Video delivery must support byte ranges and seeking.
- Secrets never enter source control, client bundles, Markdown, logs, or build output.
- The existing public Fuwari theme and static rendering remain unchanged.
- Website profile, navigation, and theme editing are outside this release.

---

## File Map

### Shared contracts and pure modules

- `src/admin/contracts.ts`: request/response and editor types shared by client and Functions.
- `functions/_lib/http.ts`: JSON responses, cookies, origin checks, and error normalization.
- `functions/_lib/session.ts`: signed session and OAuth-state cookies.
- `functions/_lib/posts.ts`: frontmatter validation, parsing, serialization, and slug confinement.
- `functions/_lib/github.ts`: GitHub REST calls for identity, posts, and workflow runs.
- `functions/_lib/media.ts`: media validation, object keys, and Range parsing.
- `functions/_lib/guard.ts`: session, CSRF, and owner authorization.

### Pages Functions

- `functions/api/admin/auth/login.ts`
- `functions/api/admin/auth/callback.ts`
- `functions/api/admin/auth/session.ts`
- `functions/api/admin/auth/logout.ts`
- `functions/api/admin/posts/index.ts`
- `functions/api/admin/posts/[slug].ts`
- `functions/api/admin/deployments.ts`
- `functions/api/admin/media/index.ts`
- `functions/api/admin/media/object/[encodedKey].ts`
- `functions/api/admin/media/upload.ts`
- `functions/api/admin/media/uploads/index.ts`
- `functions/api/admin/media/uploads/[uploadId]/parts/[partNumber].ts`
- `functions/api/admin/media/uploads/[uploadId]/complete.ts`
- `functions/api/admin/media/uploads/[uploadId]/index.ts`
- `functions/media/[[path]].ts`

### Admin client

- `src/pages/admin.astro`
- `src/admin/AdminApp.svelte`
- `src/admin/api.ts`
- `src/admin/editor.ts`
- `src/admin/components/PostList.svelte`
- `src/admin/components/PostEditor.svelte`
- `src/admin/components/MediaLibrary.svelte`
- `src/admin/components/UploadQueue.svelte`
- `src/admin/admin.css`

### Configuration, tests, and deployment

- `wrangler.jsonc`
- `.github/workflows/build.yml`
- `package.json`
- `tsconfig.admin.json`
- `tests/admin/posts.test.ts`
- `tests/admin/session.test.ts`
- `tests/admin/media.test.ts`
- `tests/admin/guard.test.ts`
- `tests/admin/github.test.ts`

---

### Task 1: Add the test harness, dependencies, contracts, and Cloudflare environment types

**Files:**
- Modify: `package.json`
- Create: `src/admin/contracts.ts`
- Create: `functions/_lib/env.ts`
- Create: `vitest.config.ts`
- Create: `tsconfig.admin.json`
- Create: `tests/admin/contracts.test.ts`

**Interfaces:**
- Produces `AdminEnv`, `PostDocument`, `PostSummary`, `MediaObject`, `DeploymentSummary`, and `ApiErrorBody` for all later tasks.
- Produces `pnpm test`, `pnpm test:run`, and `pnpm type-check:admin` commands.

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```powershell
corepack pnpm add yaml marked dompurify
corepack pnpm add -D vitest @cloudflare/workers-types
```

Expected: `package.json` and `pnpm-lock.yaml` contain the new direct dependencies.

- [ ] **Step 2: Add test scripts**

Add to `package.json` scripts:

```json
"test": "vitest",
"test:run": "vitest run",
"type-check:admin": "tsc -p tsconfig.admin.json --noEmit"
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
});
```

Create `tsconfig.admin.json` so Functions and tests are actually type checked instead of relying on the existing `tsconfig.json`, which intentionally includes only `src/`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": false,
    "isolatedDeclarations": false,
    "types": ["@cloudflare/workers-types", "vitest/globals"]
  },
  "include": ["src/admin/**/*.ts", "src/admin/**/*.svelte", "functions/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write the contracts test first**

Create `tests/admin/contracts.test.ts`:

```ts
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
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `corepack pnpm test:run tests/admin/contracts.test.ts`

Expected: FAIL because `src/admin/contracts.ts` does not exist.

- [ ] **Step 5: Create shared contracts and environment types**

Create `src/admin/contracts.ts`:

```ts
export interface PostFields {
  title: string;
  published: string;
  updated?: string;
  description: string;
  image: string;
  tags: string[];
  category: string;
  draft: boolean;
  lang: string;
  body: string;
}

export interface PostDocument extends PostFields {
  slug: string;
  sha: string | null;
}

export interface PostSummary {
  slug: string;
  sha: string;
  title: string;
  published: string;
  draft: boolean;
}

export type MediaKind = "image" | "video";

export interface MediaObject {
  key: string;
  url: string;
  kind: MediaKind;
  contentType: string;
  size: number;
  uploaded: string;
  etag: string;
}

export interface UploadSession {
  key: string;
  uploadId: string;
  partSize: number;
}

export interface UploadedPartInput {
  partNumber: number;
  etag: string;
}

export interface DeploymentSummary {
  id: number;
  status: "queued" | "in_progress" | "completed";
  conclusion: string | null;
  htmlUrl: string;
  createdAt: string;
  headSha: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user?: string;
  csrfToken?: string;
}

export interface ApiErrorBody {
  error: string;
  fields?: Record<string, string>;
}
```

Create `functions/_lib/env.ts`:

```ts
export interface AdminEnv {
  MEDIA_BUCKET: R2Bucket;
  GITHUB_OAUTH_CLIENT_ID: string;
  GITHUB_OAUTH_CLIENT_SECRET: string;
  GITHUB_CONTENT_TOKEN: string;
  SESSION_SECRET: string;
  SITE_ORIGIN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
}

export type PagesContext<Params extends string = string> = EventContext<
  AdminEnv,
  Params,
  Record<string, unknown>
>;
```

- [ ] **Step 6: Run the test and type check**

Run:

```powershell
corepack pnpm test:run tests/admin/contracts.test.ts
corepack pnpm type-check:admin
```

Expected: both commands PASS.

- [ ] **Step 7: Commit**

```powershell
git add package.json pnpm-lock.yaml vitest.config.ts tsconfig.admin.json src/admin/contracts.ts functions/_lib/env.ts tests/admin/contracts.test.ts
git commit -m "test: add admin contracts and test harness"
```

---

### Task 2: Implement post parsing, validation, and serialization

**Files:**
- Create: `functions/_lib/posts.ts`
- Create: `tests/admin/posts.test.ts`

**Interfaces:**
- Consumes `PostDocument` and `PostFields` from `src/admin/contracts.ts`.
- Produces `validateSlug`, `postPath`, `parsePost`, and `serializePost` for GitHub endpoints.

- [ ] **Step 1: Write failing post tests**

Create `tests/admin/posts.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parsePost, postPath, serializePost, validateSlug } from "../../functions/_lib/posts";

describe("post documents", () => {
  it("confines valid slugs to the posts directory", () => {
    expect(postPath("hello-world")).toBe("src/content/posts/hello-world.md");
    expect(() => validateSlug("../secret")).toThrow("Invalid slug");
    expect(() => validateSlug("Hello World")).toThrow("Invalid slug");
  });

  it("round trips Fuwari frontmatter", () => {
    const source = `---\ntitle: Hello\npublished: 2026-09-24\ndescription: Intro\nimage: /media/images/a.webp\ntags: [Notes]\ncategory: General\ndraft: false\nlang: zh_CN\n---\n\nBody\n`;
    const parsed = parsePost("hello", "sha1", source);
    expect(parsed.title).toBe("Hello");
    expect(parsed.body).toBe("Body\n");
    expect(parsePost("hello", "sha2", serializePost(parsed)).tags).toEqual(["Notes"]);
  });

  it("rejects missing required fields", () => {
    expect(() => parsePost("bad", "sha", "---\npublished: 2026-09-24\n---\n"))
      .toThrow("title");
  });
});
```

- [ ] **Step 2: Run the post tests and verify failure**

Run: `corepack pnpm test:run tests/admin/posts.test.ts`

Expected: FAIL because `functions/_lib/posts.ts` does not exist.

- [ ] **Step 3: Implement the pure post module**

Create `functions/_lib/posts.ts`:

```ts
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
  if (result && !/^\d{4}-\d{2}-\d{2}$/.test(result)) throw new Error(`${field} must be YYYY-MM-DD`);
  return result;
}

export function validatePostFields(value: Partial<PostFields>): PostFields {
  return {
    title: text(value.title, "title", true),
    published: isoDate(value.published, "published", true),
    updated: isoDate(value.updated, "updated") || undefined,
    description: text(value.description, "description"),
    image: text(value.image, "image"),
    tags: Array.isArray(value.tags) ? value.tags.map((tag) => text(tag, "tag", true)) : [],
    category: text(value.category, "category"),
    draft: Boolean(value.draft),
    lang: text(value.lang, "lang"),
    body: typeof value.body === "string" ? value.body : "",
  };
}

export function parsePost(slug: string, sha: string, source: string): PostDocument {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) throw new Error("Post frontmatter is missing");
  const data = YAML.parse(match[1]) as Partial<PostFields>;
  return { slug: validateSlug(slug), sha, ...validatePostFields({ ...data, body: match[2] }) };
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
```

- [ ] **Step 4: Run tests and type check**

Run:

```powershell
corepack pnpm test:run tests/admin/posts.test.ts
corepack pnpm type-check:admin
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add functions/_lib/posts.ts tests/admin/posts.test.ts
git commit -m "feat: validate and serialize admin posts"
```

---

### Task 3: Implement signed sessions, CSRF protection, and GitHub OAuth

**Files:**
- Create: `functions/_lib/http.ts`
- Create: `functions/_lib/session.ts`
- Create: `functions/_lib/guard.ts`
- Create: `functions/api/admin/auth/login.ts`
- Create: `functions/api/admin/auth/callback.ts`
- Create: `functions/api/admin/auth/session.ts`
- Create: `functions/api/admin/auth/logout.ts`
- Create: `tests/admin/session.test.ts`
- Create: `tests/admin/guard.test.ts`

**Interfaces:**
- Consumes `AdminEnv`, `PagesContext`, and `SessionResponse`.
- Produces `createSignedValue`, `readSignedValue`, `requireAdmin`, `requireMutation`, and the four OAuth/session routes.

- [ ] **Step 1: Write failing session and guard tests**

Create `tests/admin/session.test.ts` with cases for a valid session, expiry, payload tampering, and a wrong secret. Create `tests/admin/guard.test.ts` with cases for the exact production origin, missing CSRF header, and non-owner sessions. Use this concrete session payload in both files:

```ts
const payload = {
  login: "JL7007",
  csrfToken: "csrf-123",
  sessionId: "session-123",
  issuedAt: 1_790_000_000,
  expiresAt: 1_790_043_200,
};
```

The primary assertions are:

```ts
expect((await readSignedValue(token, "secret", 1_790_000_100))?.login).toBe("JL7007");
expect(await readSignedValue(`${token}x`, "secret", 1_790_000_100)).toBeNull();
expect(() => assertAllowedOrigin(new Request("https://x/api", { method: "POST", headers: { Origin: "https://evil.example" } }), "https://fuwari-ad9.pages.dev")).toThrow("Invalid origin");
```

- [ ] **Step 2: Verify the security tests fail**

Run: `corepack pnpm test:run tests/admin/session.test.ts tests/admin/guard.test.ts`

Expected: FAIL because the security modules do not exist.

- [ ] **Step 3: Implement HTTP and signed-session primitives**

`functions/_lib/http.ts` must export:

```ts
export function json(data: unknown, init: ResponseInit = {}): Response;
export function parseCookies(request: Request): Map<string, string>;
export function cookie(name: string, value: string, options: { maxAge: number; httpOnly: boolean }): string;
export function clearCookie(name: string): string;
export function assertAllowedOrigin(request: Request, origin: string): void;
export function errorResponse(error: unknown): Response;
```

Use `Path=/; Secure; SameSite=Lax`; add `HttpOnly` when requested. `assertAllowedOrigin` must apply to `POST`, `PUT`, `PATCH`, and `DELETE` and compare `new URL(originHeader).origin` with `new URL(origin).origin`.

`functions/_lib/session.ts` must export:

```ts
export interface SessionPayload {
  login: string;
  csrfToken: string;
  sessionId: string;
  issuedAt: number;
  expiresAt: number;
}

export async function createSignedValue(payload: SessionPayload, secret: string): Promise<string>;
export async function readSignedValue(token: string, secret: string, now?: number): Promise<SessionPayload | null>;
export function randomToken(bytes?: number): string;
```

Encode payload and HMAC-SHA-256 signature as base64url segments separated by `.`. Verify signatures with `crypto.subtle.verify` and reject expired sessions.

- [ ] **Step 4: Implement guards**

`functions/_lib/guard.ts` must export:

```ts
export const SESSION_COOKIE = "fuwari_admin";
export const OAUTH_STATE_COOKIE = "fuwari_oauth_state";
export async function requireAdmin(request: Request, env: AdminEnv): Promise<SessionPayload>;
export async function requireMutation(request: Request, env: AdminEnv): Promise<SessionPayload>;
```

`requireAdmin` parses and verifies `SESSION_COOKIE` and checks `login.toLowerCase() === "jl7007"`. `requireMutation` additionally calls `assertAllowedOrigin` and compares `X-CSRF-Token` with `session.csrfToken` using a constant-time comparison.

- [ ] **Step 5: Implement OAuth routes**

Use these exact route behaviors:

```ts
// login.ts
// Generate a 10-minute signed state cookie, construct a URL with
// new URL("https://github.com/login/oauth/authorize"), then set client_id from
// env.GITHUB_OAUTH_CLIENT_ID, redirect_uri from `${env.SITE_ORIGIN}/api/admin/auth/callback`,
// scope to "read:user", and state to the generated random state value.

// callback.ts
// Verify query code/state and state cookie.
// POST code/client_id/client_secret to https://github.com/login/oauth/access_token.
// GET https://api.github.com/user with the returned bearer token.
// Reject unless login is JL7007.
// Set a 12-hour signed session cookie and redirect to /admin.

// session.ts
// Return { authenticated: false } or { authenticated: true, user: "JL7007", csrfToken }.

// logout.ts
// Call requireMutation so session, origin, and CSRF are verified, then clear the session cookie.
```

All GitHub requests must include `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and `User-Agent: fuwari-admin`.

- [ ] **Step 6: Run security tests**

Run:

```powershell
corepack pnpm test:run tests/admin/session.test.ts tests/admin/guard.test.ts
corepack pnpm type-check:admin
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add functions/_lib/http.ts functions/_lib/session.ts functions/_lib/guard.ts functions/api/admin/auth tests/admin/session.test.ts tests/admin/guard.test.ts
git commit -m "feat: add owner-only GitHub authentication"
```

---

### Task 4: Implement GitHub post storage and deployment status APIs

**Files:**
- Create: `functions/_lib/github.ts`
- Create: `functions/api/admin/posts/index.ts`
- Create: `functions/api/admin/posts/[slug].ts`
- Create: `functions/api/admin/deployments.ts`
- Create: `tests/admin/github.test.ts`

**Interfaces:**
- Consumes post helpers, `AdminEnv`, `requireAdmin`, and `requireMutation`.
- Produces `listPosts`, `getPost`, `createPost`, `updatePost`, `deletePost`, and `listDeployments`.

- [ ] **Step 1: Write failing GitHub adapter tests**

Mock `globalThis.fetch` and assert:

```ts
expect(request.url).toBe("https://api.github.com/repos/JL7007/fuwari/contents/src/content/posts/hello.md");
expect(request.headers.get("authorization")).toBe("Bearer token-value");
expect(JSON.parse(await request.text())).toMatchObject({
  message: "content: publish hello",
  branch: "main",
  sha: "old-sha",
});
```

Also test that a GitHub 409 maps to a local `GitConflictError`, a 404 maps to `GitNotFoundError`, and base64 content containing UTF-8 Chinese round trips correctly.

- [ ] **Step 2: Verify adapter tests fail**

Run: `corepack pnpm test:run tests/admin/github.test.ts`

Expected: FAIL because `functions/_lib/github.ts` does not exist.

- [ ] **Step 3: Implement the GitHub adapter**

Create `functions/_lib/github.ts` with this exported surface:

```ts
export class GitConflictError extends Error {}
export class GitNotFoundError extends Error {}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
}

export async function listPosts(config: GitHubConfig): Promise<PostSummary[]>;
export async function getPost(config: GitHubConfig, slug: string): Promise<PostDocument>;
export async function createPost(config: GitHubConfig, post: PostDocument): Promise<{ sha: string; commitSha: string }>;
export async function updatePost(config: GitHubConfig, originalSlug: string, post: PostDocument): Promise<{ sha: string; commitSha: string }>;
export async function deletePost(config: GitHubConfig, slug: string, sha: string): Promise<{ commitSha: string }>;
export async function listDeployments(config: GitHubConfig): Promise<DeploymentSummary[]>;
```

Use the GitHub Contents API for `src/content/posts`. For listing, retrieve `.md` entries, fetch their contents in a bounded concurrency pool of four, parse them, and sort newest published date first. For rename, create the new path first and delete the old path only after the create succeeds. Use UTF-8-safe base64 helpers based on `TextEncoder` and `TextDecoder`.

- [ ] **Step 4: Implement post and deployment endpoints**

`functions/api/admin/posts/index.ts`:

- `GET`: call `requireAdmin`, then return `{ posts: await listPosts(config) }`.
- `POST`: call `requireMutation`, validate the JSON body, force `sha: null`, then call `createPost`.
- Return 400 for validation errors and 409 for an existing path.

`functions/api/admin/posts/[slug].ts`:

- `GET`: call `requireAdmin`, then `getPost`.
- `PUT`: call `requireMutation`; require a non-empty expected SHA; call `updatePost`.
- `DELETE`: call `requireMutation`; require the expected SHA in JSON; call `deletePost`.
- Return 404 for missing posts and 409 for stale SHAs.

`functions/api/admin/deployments.ts`:

- `GET`: call `requireAdmin`, query `/actions/runs?branch=main&per_page=10`, and return normalized `DeploymentSummary[]`.

- [ ] **Step 5: Run adapter tests and full checks**

Run:

```powershell
corepack pnpm test:run tests/admin/github.test.ts tests/admin/posts.test.ts
corepack pnpm type-check:admin
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add functions/_lib/github.ts functions/api/admin/posts functions/api/admin/deployments.ts tests/admin/github.test.ts
git commit -m "feat: manage blog posts through GitHub"
```

---

### Task 5: Implement validated R2 uploads and public media delivery

**Files:**
- Create: `functions/_lib/media.ts`
- Create: `functions/api/admin/media/index.ts`
- Create: `functions/api/admin/media/object/[encodedKey].ts`
- Create: `functions/api/admin/media/upload.ts`
- Create: `functions/api/admin/media/uploads/index.ts`
- Create: `functions/api/admin/media/uploads/[uploadId]/parts/[partNumber].ts`
- Create: `functions/api/admin/media/uploads/[uploadId]/complete.ts`
- Create: `functions/api/admin/media/uploads/[uploadId]/index.ts`
- Create: `functions/media/[[path]].ts`
- Create: `tests/admin/media.test.ts`

**Interfaces:**
- Consumes `AdminEnv`, `requireAdmin`, and `requireMutation`.
- Produces media validation, single upload, multipart upload, listing, deletion, and byte-range delivery.

- [ ] **Step 1: Write failing media tests**

Create `tests/admin/media.test.ts` with these assertions:

```ts
expect(validateMedia("photo.webp", "image/webp", 1024).kind).toBe("image");
expect(validateMedia("movie.mp4", "video/mp4", 101 * 1024 * 1024).multipart).toBe(true);
expect(() => validateMedia("payload.exe", "application/octet-stream", 1)).toThrow("Unsupported media type");
expect(() => validateMedia("huge.mp4", "video/mp4", 5 * 1024 ** 3 + 1)).toThrow("5 GB");
expect(parseRange("bytes=100-199", 1000)).toEqual({ offset: 100, length: 100 });
expect(parseRange("bytes=-200", 1000)).toEqual({ offset: 800, length: 200 });
expect(() => parseRange("bytes=1000-1100", 1000)).toThrow("Unsatisfiable range");
```

- [ ] **Step 2: Verify media tests fail**

Run: `corepack pnpm test:run tests/admin/media.test.ts`

Expected: FAIL because the media module does not exist.

- [ ] **Step 3: Implement media validation and Range parsing**

`functions/_lib/media.ts` must export:

```ts
export const PART_SIZE = 20 * 1024 * 1024;
export const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024;

export interface ValidatedMedia {
  kind: "image" | "video";
  contentType: string;
  safeName: string;
  multipart: boolean;
}

export function validateMedia(name: string, contentType: string, size: number): ValidatedMedia;
export function createMediaKey(kind: "image" | "video", safeName: string, now?: Date): string;
export function encodeKey(key: string): string;
export function decodeKey(encoded: string): string;
export function parseRange(header: string, size: number): { offset: number; length: number };
```

Map extensions and MIME types explicitly. Normalize names to lower-case ASCII letters, digits, dots, and hyphens; prefix a UUID in `createMediaKey`. Reject decoded keys beginning with `/`, containing `..`, or not beginning with `images/` or `videos/`.

- [ ] **Step 4: Implement admin media endpoints**

Use these exact request contracts:

```ts
// POST /api/admin/media/upload
// Headers: X-File-Name, Content-Type, Content-Length, X-CSRF-Token
// Body: raw file bytes, only when size <= PART_SIZE.

// POST /api/admin/media/uploads
// JSON: { name, contentType, size }
// Response: { key, uploadId, partSize: PART_SIZE }

// PUT /api/admin/media/uploads/:uploadId/parts/:partNumber?key=<encodedKey>
// Body: raw part bytes, each <= PART_SIZE.
// Response: { partNumber, etag }

// POST /api/admin/media/uploads/:uploadId/complete
// JSON: { key, parts: [{ partNumber, etag }] }

// DELETE /api/admin/media/uploads/:uploadId?key=<encodedKey>
// Abort the multipart upload.
```

Call `env.MEDIA_BUCKET.put` for single uploads and verify the received byte length equals `Content-Length`. Use `createMultipartUpload`, `resumeMultipartUpload`, `uploadPart`, `complete`, and `abort` for multipart uploads. Pass `httpMetadata: { contentType }` when calling `createMultipartUpload` so the completed object retains its media type.

`GET /api/admin/media?cursor=<cursor>&kind=image|video` lists at most 100 objects and returns `{ objects, cursor, truncated }`. `DELETE /api/admin/media/object/:encodedKey` calls `requireMutation` and deletes exactly the decoded confined key.

- [ ] **Step 5: Implement public media delivery**

`functions/media/[[path]].ts` must:

1. Accept only `GET` and `HEAD`.
2. Decode and confine the path.
3. Read object metadata before handling ranges.
4. Honor `If-None-Match` with HTTP 304.
5. Call `MEDIA_BUCKET.get(key, { range })` for valid `Range` requests.
6. Return HTTP 206 with `Accept-Ranges: bytes`, `Content-Range`, `Content-Length`, ETag, Last-Modified, Content-Type, and `Cache-Control: public, max-age=31536000, immutable`.
7. Return HTTP 416 with `Content-Range: bytes */<size>` for invalid ranges.

- [ ] **Step 6: Run media tests and type check**

Run:

```powershell
corepack pnpm test:run tests/admin/media.test.ts tests/admin/guard.test.ts
corepack pnpm type-check:admin
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add functions/_lib/media.ts functions/api/admin/media functions/media tests/admin/media.test.ts
git commit -m "feat: add R2 media uploads and delivery"
```

---

### Task 6: Build the typed admin API client and editor helpers

**Files:**
- Create: `src/admin/api.ts`
- Create: `src/admin/editor.ts`
- Create: `tests/admin/editor.test.ts`

**Interfaces:**
- Consumes shared contracts and all admin API routes.
- Produces `adminApi`, `uploadMedia`, `insertImageMarkdown`, and `insertVideoHtml` for Svelte components.

- [ ] **Step 1: Write failing editor-helper tests**

Create `tests/admin/editor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { insertImageMarkdown, insertVideoHtml } from "../../src/admin/editor";

describe("editor media insertion", () => {
  it("creates Markdown for an image", () => {
    expect(insertImageMarkdown("/media/images/a.webp", "Cover"))
      .toBe("![Cover](/media/images/a.webp)");
  });

  it("creates safe video HTML", () => {
    expect(insertVideoHtml("/media/videos/a.mp4"))
      .toBe('<video controls preload="metadata" src="/media/videos/a.mp4"></video>');
  });
});
```

- [ ] **Step 2: Verify helper tests fail**

Run: `corepack pnpm test:run tests/admin/editor.test.ts`

Expected: FAIL because `src/admin/editor.ts` does not exist.

- [ ] **Step 3: Implement editor helpers**

Create `src/admin/editor.ts`:

```ts
export function insertImageMarkdown(url: string, alt = ""): string {
  return `![${alt.replace(/[\[\]]/g, "")}](${url})`;
}

export function insertVideoHtml(url: string): string {
  const safe = url.replace(/["<>]/g, "");
  return `<video controls preload="metadata" src="${safe}"></video>`;
}

export function insertAtSelection(value: string, insertion: string, start: number, end: number) {
  const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
  const cursor = start + insertion.length;
  return { value: next, selectionStart: cursor, selectionEnd: cursor };
}
```

- [ ] **Step 4: Implement the API client and resumable upload coordinator**

`src/admin/api.ts` must export one `adminApi` object with methods for session, logout, posts, media, and deployments. Centralize fetch behavior in:

```ts
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (csrfToken && !["GET", "HEAD"].includes(init.method ?? "GET")) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (init.body && typeof init.body === "string") headers.set("Content-Type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "same-origin" });
  if (!response.ok) throw await ApiError.fromResponse(response);
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
```

Implement `uploadMedia(file, onProgress, signal)` as follows:

- validate the 5 GB maximum before network activity;
- use `/api/admin/media/upload` for files at or below 20 MB;
- initialize multipart upload for larger files;
- upload parts sequentially so memory remains bounded;
- retry a failed part three times after 500 ms, 1500 ms, and 3000 ms;
- abort the multipart upload when the supplied signal is aborted;
- call completion with sorted `{ partNumber, etag }` values;
- report progress as uploaded bytes divided by total bytes.

- [ ] **Step 5: Run tests and type check**

Run:

```powershell
corepack pnpm test:run tests/admin/editor.test.ts
corepack pnpm type-check:admin
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/admin/api.ts src/admin/editor.ts tests/admin/editor.test.ts
git commit -m "feat: add typed admin client and upload coordinator"
```

---

### Task 7: Build the unified Svelte admin interface

**Files:**
- Create: `src/admin/AdminApp.svelte`
- Create: `src/admin/components/PostList.svelte`
- Create: `src/admin/components/PostEditor.svelte`
- Create: `src/admin/components/MediaLibrary.svelte`
- Create: `src/admin/components/UploadQueue.svelte`
- Create: `src/admin/admin.css`
- Create: `src/pages/admin.astro`

**Interfaces:**
- Consumes `adminApi`, upload helpers, editor helpers, and shared contracts.
- Produces the complete `/admin` user experience.

- [ ] **Step 1: Create the protected admin route shell**

Create `src/pages/admin.astro`:

```astro
---
import AdminApp from "../admin/AdminApp.svelte";
import "../admin/admin.css";
---

<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Fuwari 管理后台</title>
  </head>
  <body>
    <AdminApp client:only="svelte" />
  </body>
</html>
```

- [ ] **Step 2: Implement `AdminApp.svelte` state flow**

The root component must use these states:

```ts
type View = "posts" | "editor" | "media";
let session: SessionResponse | null = null;
let posts: PostSummary[] = [];
let selected: PostDocument | null = null;
let view: View = "posts";
let busy = false;
let notice = "";
let error = "";
```

On mount, load the session. Show a single **使用 GitHub 登录** link to `/api/admin/auth/login` when unauthenticated. When authenticated, load posts and render tab buttons, `PostList`, `PostEditor`, and `MediaLibrary`. Keep unsaved editor contents in component state if an API request fails. Poll deployments every 15 seconds only while a deployment is queued or in progress.

- [ ] **Step 3: Implement the post list and editor**

`PostList.svelte` must expose callbacks `onopen`, `oncreate`, `onduplicate`, and `ondelete`. It filters locally by title or slug and marks drafts with `草稿`.

`PostEditor.svelte` must bind every `PostDocument` field, render Markdown preview with `marked`, sanitize the preview with DOMPurify, and expose:

```ts
export let onSave: (post: PostDocument, publish: boolean) => Promise<void>;
export let onOpenMedia: () => void;
```

**Save draft** sets `draft: true`; **Publish** sets `draft: false` and `updated` to the current local date before calling `onSave`. When API status is 409, show `文章已在其他位置更新，请重新加载后再保存。` and do not replace editor contents.

- [ ] **Step 4: Implement media library and upload queue**

`MediaLibrary.svelte` must:

- accept image and video files through file selection and drag/drop;
- call `uploadMedia` for each file;
- show filename, total size, percentage, current state, retry, and cancel in `UploadQueue`;
- filter the media list by All, Images, and Videos;
- provide **复制地址**, **插入文章**, and **删除** actions;
- require the user to type the final filename before delete when a loaded post contains the media URL;
- insert image Markdown or video HTML at the editor selection.

- [ ] **Step 5: Implement responsive styles**

`src/admin/admin.css` must define:

- a fixed top bar with account, deployment state, and logout;
- a three-column desktop grid with minimum editor width 520 px;
- a tabbed single-panel layout below 800 px;
- visible keyboard focus outlines;
- light and dark color variables using `prefers-color-scheme`;
- upload progress bars and destructive button styling;
- editor textarea and preview areas with equal minimum height of 60vh.

- [ ] **Step 6: Run local UI and verify manually**

Run: `corepack pnpm dev`

Open: `http://localhost:4321/admin`

Expected before Functions emulation: the page renders without a Svelte exception and shows a recoverable session-loading error rather than a blank page.

- [ ] **Step 7: Run all automated checks**

Run:

```powershell
corepack pnpm test:run
corepack pnpm type-check:admin
corepack pnpm astro check
corepack pnpm build
```

Expected: all commands PASS and `dist/admin/index.html` exists.

- [ ] **Step 8: Commit**

```powershell
git add src/admin src/pages/admin.astro
git commit -m "feat: build unified blog admin interface"
```

---

### Task 8: Configure Cloudflare Pages, R2 binding, and automatic GitHub deployment

**Files:**
- Create: `wrangler.jsonc`
- Modify: `.github/workflows/build.yml`
- Modify: `.gitignore`

**Interfaces:**
- Consumes the Functions directory, `dist/`, GitHub secrets, and the R2 bucket.
- Produces reproducible local Pages testing and automatic production deployment.

- [ ] **Step 1: Create Pages configuration**

Create `wrangler.jsonc`:

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "fuwari",
  "pages_build_output_dir": "./dist",
  "compatibility_date": "2026-09-24",
  "vars": {
    "SITE_ORIGIN": "https://fuwari-ad9.pages.dev",
    "GITHUB_OWNER": "JL7007",
    "GITHUB_REPO": "fuwari"
  },
  "r2_buckets": [
    {
      "binding": "MEDIA_BUCKET",
      "bucket_name": "fuwari-media"
    }
  ]
}
```

Add these entries to `.gitignore`:

```gitignore
.dev.vars
.wrangler/
```

- [ ] **Step 2: Replace the matrix workflow with check and deploy jobs**

Update `.github/workflows/build.yml` so it:

- runs on pull requests to `main` and pushes to `main`;
- grants `contents: read`;
- uses Node 22 and pnpm 9.14.4;
- runs `pnpm install --frozen-lockfile`, `pnpm test:run`, `pnpm type-check:admin`, `pnpm astro check`, and `pnpm build`;
- runs the deployment job only for pushes to `main` after checks pass;
- deploys with `cloudflare/wrangler-action@v3` and this command:

```yaml
command: pages deploy dist --project-name fuwari --branch main --commit-hash ${{ github.sha }} --commit-message "${{ github.event.head_commit.message }}"
apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
```

- [ ] **Step 3: Validate configuration locally**

Run:

```powershell
corepack pnpm build
wrangler pages functions build --project-directory .
```

Expected: Astro and Pages Functions bundles build without missing binding or TypeScript errors.

- [ ] **Step 4: Commit without pushing**

Do not push until the infrastructure secrets in Task 9 exist, because a push to `main` now starts the deployment workflow.

```powershell
git add wrangler.jsonc .github/workflows/build.yml .gitignore
git commit -m "ci: deploy admin and blog to Cloudflare Pages"
```

---

### Task 9: Provision R2, OAuth, Cloudflare secrets, and GitHub Actions secrets

**Files:**
- No tracked file changes.

**Interfaces:**
- Consumes the authenticated Wrangler session and owner-authorized GitHub/Cloudflare settings.
- Produces every runtime binding and secret required for deployment.

- [ ] **Step 1: Create the R2 bucket**

Run:

```powershell
wrangler r2 bucket create fuwari-media
wrangler r2 bucket list
```

Expected: `fuwari-media` appears exactly once. If it already exists, keep the existing bucket and do not recreate it.

- [ ] **Step 2: Create the GitHub OAuth App**

In GitHub **Settings → Developer settings → OAuth Apps → New OAuth App**, enter:

- Application name: `Fuwari Admin`
- Homepage URL: `https://fuwari-ad9.pages.dev`
- Authorization callback URL: `https://fuwari-ad9.pages.dev/api/admin/auth/callback`

Record the generated client ID and generate one client secret. Do not save the secret in a file.

- [ ] **Step 3: Create a repository-scoped GitHub token**

Create a fine-grained personal access token for owner `JL7007`, repository `fuwari`, with:

- Contents: Read and write
- Actions: Read
- Metadata: Read

Use the shortest acceptable expiry supported by the owner's maintenance schedule and record its expiry date outside the repository.

- [ ] **Step 4: Store Cloudflare Pages secrets**

Run each command and paste only the requested value into Wrangler's hidden prompt:

```powershell
wrangler pages secret put GITHUB_OAUTH_CLIENT_ID --project-name fuwari
wrangler pages secret put GITHUB_OAUTH_CLIENT_SECRET --project-name fuwari
wrangler pages secret put GITHUB_CONTENT_TOKEN --project-name fuwari
wrangler pages secret put SESSION_SECRET --project-name fuwari
```

Generate `SESSION_SECRET` with:

```powershell
$bytes = New-Object byte[] 32
[Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
[Convert]::ToBase64String($bytes)
```

Paste it into the hidden Wrangler prompt, then clear the PowerShell variable with `Remove-Variable bytes`.

- [ ] **Step 5: Create a least-privilege Cloudflare API token**

Create a Cloudflare API token limited to account `0cae4ac5b87edfe63f89c70a40e99a19` with:

- Account → Cloudflare Pages → Edit
- Account → Account Settings → Read

Copy it only once for the next step.

- [ ] **Step 6: Store GitHub Actions secrets**

Use GitHub repository settings or authenticated `gh secret set` to create two secrets. Set `CLOUDFLARE_ACCOUNT_ID` to the exact account ID below, and paste the token copied in Step 5 into the hidden prompt for `CLOUDFLARE_API_TOKEN`:

```text
CLOUDFLARE_ACCOUNT_ID=0cae4ac5b87edfe63f89c70a40e99a19
CLOUDFLARE_API_TOKEN is the secret name for the token copied in Step 5
```

Verify only the secret names are listed; never print their values.

- [ ] **Step 7: Push the implementation and observe deployment**

Run:

```powershell
git push origin main
```

Expected: the **Build and Check** workflow passes and deploys commit `HEAD` to the `fuwari` Pages project.

---

### Task 10: Perform production acceptance testing

**Files:**
- Modify only files required to fix defects discovered by these checks.

**Interfaces:**
- Consumes the deployed admin, OAuth App, R2 bucket, and GitHub workflow.
- Produces an evidence-backed production handoff.

- [ ] **Step 1: Verify unauthenticated protection**

Open `https://fuwari-ad9.pages.dev/admin` in a signed-out browser and call one read and one write API.

Expected:

- the admin shows **使用 GitHub 登录**;
- `GET /api/admin/posts` returns 401;
- `POST /api/admin/posts` returns 401;
- no repository or media metadata is exposed.

- [ ] **Step 2: Verify owner-only OAuth**

Sign in with `JL7007`.

Expected: redirect back to `/admin`, session shows `JL7007`, and no OAuth token appears in the URL, DOM, local storage, or session storage.

Use a different GitHub account if one is available.

Expected: HTTP 403 and no admin session cookie.

- [ ] **Step 3: Verify post lifecycle**

Create slug `admin-acceptance-test` with Chinese title/body, save as draft, reopen it, publish it, then verify:

- the GitHub file exists at `src/content/posts/admin-acceptance-test.md`;
- frontmatter passes `pnpm astro check`;
- the GitHub Actions run succeeds;
- the public post renders at `/posts/admin-acceptance-test/`;
- editing with a stale SHA produces the conflict message without losing typed text.

- [ ] **Step 4: Verify image upload and insertion**

Upload a WebP image, insert it into the acceptance post, publish, and verify:

- the object appears under `images/<year>/<month>/` in R2;
- the public `/media/images/...` URL returns the correct Content-Type and ETag;
- the article displays the image after deployment.

- [ ] **Step 5: Verify a video larger than 100 MB**

Upload an MP4 larger than 100 MB and verify:

- progress advances part by part;
- cancelling a second test upload aborts it;
- retrying a deliberately interrupted part succeeds without restarting completed parts;
- the completed object appears under `videos/<year>/<month>/`;
- a `Range: bytes=0-1023` request returns HTTP 206 and a valid `Content-Range`;
- the browser can play and seek in the inserted video.

- [ ] **Step 6: Verify destructive confirmations**

Attempt to delete the acceptance post and referenced media.

Expected: both require explicit confirmation; referenced media shows the stronger filename confirmation. Complete deletion only after recording the successful media playback evidence.

- [ ] **Step 7: Verify responsive admin layout**

Check widths 1440 px, 1024 px, 768 px, and 390 px.

Expected: desktop shows the multi-panel layout; widths below 800 px show tab navigation; all form controls, dialogs, progress bars, and editor actions remain reachable by keyboard.

- [ ] **Step 8: Run final repository checks and commit any fixes**

Run:

```powershell
corepack pnpm test:run
corepack pnpm type-check:admin
corepack pnpm astro check
corepack pnpm build
git status --short
```

Expected: tests, type checks, and build pass. Commit defect fixes in focused commits, push `main`, wait for the deployment workflow, and recheck the affected production behavior.
