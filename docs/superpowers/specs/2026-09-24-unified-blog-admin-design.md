# Fuwari Unified Blog Admin Design

## Summary

Add a private, unified administration interface at `/admin` to the existing Fuwari Astro blog. The interface will let the repository owner create, edit, preview, publish, and delete posts and manage images and videos from one page. Posts remain Markdown files in GitHub, while media is stored in Cloudflare R2 so video files can exceed GitHub's 100 MB file limit.

The existing public site remains a statically generated Astro site deployed to the `fuwari` Cloudflare Pages project at `https://fuwari-ad9.pages.dev/`.

## Goals

- Provide a single `/admin` page for post and media management.
- Allow only the GitHub user `JL7007` to sign in.
- Store posts in `src/content/posts/` as Fuwari-compatible Markdown.
- Store images and videos in Cloudflare R2.
- Support individual media files up to 5 GB through multipart uploads.
- Automatically rebuild and deploy the public blog after a post change.
- Keep all credentials out of the repository.

## Non-goals

- Multiple administrators, roles, or invitations.
- Editing site title, profile, navigation, or theme settings in the first release.
- Automatic video transcoding or multiple-quality streaming.
- Scheduled publishing, revision comparison, comments, analytics, or asset transformation.
- Replacing Astro or changing the existing public theme.

## Architecture

The feature has four bounded components:

1. **Admin client**: an Astro route at `/admin` containing a Svelte application for post editing, preview, deployment status, and media management.
2. **Admin API**: Cloudflare Pages Functions under `/api/admin/*` for authentication, GitHub content operations, R2 upload coordination, and deployment status.
3. **Media delivery**: a Pages Function under `/media/*` that reads objects from an R2 binding and implements cache headers, content types, byte ranges, and conditional requests.
4. **Deployment workflow**: a GitHub Actions workflow that builds the Astro site and uploads `dist/` to the existing Cloudflare Pages project on changes to `main`.

The public blog remains static. Only `/admin`, `/api/admin/*`, and `/media/*` require runtime Functions.

## Authentication and Authorization

Authentication uses a GitHub OAuth App with this production callback:

`https://fuwari-ad9.pages.dev/api/admin/auth/callback`

The flow is:

1. `/admin` requests the current session.
2. An unauthenticated user selects **Sign in with GitHub**.
3. `/api/admin/auth/login` creates a short-lived OAuth state value and redirects to GitHub.
4. GitHub returns to `/api/admin/auth/callback`.
5. The callback exchanges the code, requests the authenticated GitHub user, and accepts only the exact login `JL7007` using a case-insensitive comparison.
6. The API issues a signed session cookie and removes the temporary OAuth state cookie.

Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, scoped to `/`, and expire after 12 hours. The session payload contains only the GitHub login, issued-at time, expiry, and a random session identifier. It is authenticated with HMAC-SHA-256 using `SESSION_SECRET`.

Every state-changing request must:

- have a valid session;
- originate from `https://fuwari-ad9.pages.dev`;
- provide the current CSRF token in an `X-CSRF-Token` header; and
- use JSON or an explicitly supported binary upload content type.

The OAuth token is used only to establish identity and is not returned to the browser. Repository reads and writes use a fine-grained GitHub token stored as `GITHUB_CONTENT_TOKEN` in Cloudflare Secrets, restricted to the `JL7007/fuwari` repository with Contents read/write permission.

## Admin Interface

The admin application uses the project's existing Svelte integration and has three main regions:

- **Post list**: search, create, duplicate, open, and delete posts; show slug and draft/published state.
- **Editor**: edit title, slug, published date, description, category, tags, cover image, draft state, language, and Markdown body. Show a rendered preview beside or below the editor depending on viewport width.
- **Media library**: filter images and videos, upload files, show progress, copy URLs, insert media into the editor, and delete media after confirmation.

Desktop uses a resizable list/editor/media layout. Small screens use tab navigation with Editor, Posts, and Media tabs. The editor uses explicit **Save draft** and **Publish** actions; there is no background autosave in the first release.

Image insertion generates:

```markdown
![Alternative text](/media/images/example.webp)
```

Video insertion generates:

```html
<video controls preload="metadata" src="/media/videos/example.mp4"></video>
```

## Post Data Model

Post files continue to use the existing Fuwari schema:

```yaml
---
title: Example title
published: 2026-09-24
updated: 2026-09-24
description: Example description
image: /media/images/example.webp
tags: [Example]
category: Notes
draft: false
lang: zh_CN
---
```

The API validates all frontmatter before committing it. Slugs are lower-case URL-safe values containing letters, numbers, and hyphens. A post is stored at `src/content/posts/<slug>.md`. Existing nested posts remain readable, but newly created posts use the flat layout.

The API reads the current Git blob SHA when opening a post. Updates include that SHA so concurrent or stale edits produce an HTTP 409 conflict instead of overwriting a newer version.

## GitHub Content API

The admin API exposes these operations:

- `GET /api/admin/posts`: list post metadata.
- `GET /api/admin/posts/:slug`: read one post and its current SHA.
- `POST /api/admin/posts`: create a post.
- `PUT /api/admin/posts/:slug`: update or rename a post using the expected SHA.
- `DELETE /api/admin/posts/:slug`: delete a post using the expected SHA.
- `GET /api/admin/deployments`: return recent GitHub Actions workflow runs.

Create, update, rename, and delete operations use the GitHub Contents API and commit directly to `main`. Commit messages identify the operation and slug, for example `content: publish my-first-post`.

The API never accepts arbitrary repository paths. It derives paths from validated slugs and restricts all post operations to `src/content/posts/`.

## Media Storage and Uploads

Cloudflare R2 uses one bucket bound to Pages Functions as `MEDIA_BUCKET`. Objects use these prefixes:

- `images/<yyyy>/<mm>/<random-id>-<safe-name>`
- `videos/<yyyy>/<mm>/<random-id>-<safe-name>`

Allowed image types are JPEG, PNG, GIF, WebP, AVIF, and SVG. Allowed video types are MP4, WebM, MOV, and M4V. Both the declared MIME type and file extension are checked. File names are normalized and prefixed with a random identifier.

Files of 20 MB or less use a single upload request. Larger files use R2 multipart upload with 20 MB parts:

1. `POST /api/admin/media/uploads` validates metadata and starts an R2 multipart upload.
2. `PUT /api/admin/media/uploads/:uploadId/parts/:partNumber` uploads one part.
3. `POST /api/admin/media/uploads/:uploadId/complete` verifies the submitted part list and completes the object.
4. `DELETE /api/admin/media/uploads/:uploadId` aborts a cancelled or failed upload.

Twenty-megabyte requests remain below Cloudflare's normal request-body limit while allowing a total file size up to 5 GB. The browser retries an individual failed part up to three times with increasing delays. Successfully uploaded parts are not resent.

The media API also provides:

- `GET /api/admin/media`: paginated image and video listing.
- `DELETE /api/admin/media/:encodedKey`: delete an object after confirmation.

Before deletion, the client checks loaded post content for references and warns when a known reference exists. The server still requires explicit confirmation because the client cannot prove that an object is unused in every historical or external location.

## Media Delivery

`GET` and `HEAD` requests to `/media/:key` read from R2. Responses include the stored content type, ETag, Last-Modified, and public cache headers. Valid byte range requests return HTTP 206 with `Content-Range`, enabling seeking in large videos. Invalid ranges return HTTP 416.

Media is public because it is embedded in public blog posts. Upload, listing, and deletion endpoints remain private.

## Automatic Deployment

The existing Cloudflare Pages project was created with Direct Upload, so it cannot be converted to Cloudflare Git integration. A GitHub Actions workflow will provide equivalent automatic deployment:

1. A content commit reaches `main`.
2. GitHub Actions checks out the repository and installs the locked pnpm dependencies.
3. The workflow runs `pnpm astro check` and `pnpm build`.
4. On success, Wrangler uploads `dist/` and the Functions bundle to the existing `fuwari` Pages project.

The workflow uses repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The Cloudflare token is scoped to Pages deployment for the owner's account. The admin deployment-status view links to the corresponding GitHub Actions run when a build fails.

## Error Handling

- Authentication failures clear invalid cookies and return the user to the login state.
- A non-`JL7007` GitHub account receives HTTP 403 and no session.
- Invalid post fields return HTTP 400 with field-specific messages.
- Stale Git SHAs return HTTP 409 and require the editor to reload before saving.
- GitHub API failures preserve the editor contents in browser memory and show a retry action.
- Media validation failures occur before upload initialization.
- Failed multipart parts can be retried independently; cancellation aborts the R2 upload.
- A failed deployment does not revert the GitHub commit. The admin shows the failed workflow and allows a rerun after correction.
- Destructive post and media operations require a confirmation dialog naming the exact item.

## Secrets and Cloudflare Bindings

Cloudflare Secrets:

- `GITHUB_OAUTH_CLIENT_ID`
- `GITHUB_OAUTH_CLIENT_SECRET`
- `GITHUB_CONTENT_TOKEN`
- `SESSION_SECRET`

Cloudflare binding:

- `MEDIA_BUCKET`: the R2 bucket used for images and videos.

GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

No secret or access token is sent to the admin client, committed to Git, placed in Markdown, or included in build output.

## Testing and Verification

Automated tests cover:

- session signing, expiry, tampering, and the `JL7007` allowlist;
- OAuth state validation and callback failures;
- origin and CSRF rejection for state-changing requests;
- frontmatter parsing, validation, and serialization;
- slug validation and repository path confinement;
- Git SHA conflict handling;
- file type, file size, and multipart part validation;
- multipart completion and abort behavior;
- media byte range parsing and responses.

Build verification runs:

- `pnpm astro check`
- `pnpm build`
- unit tests for shared admin and API modules

Manual acceptance verifies:

1. An unauthenticated visitor cannot use `/admin` APIs.
2. GitHub login works only for `JL7007`.
3. A draft can be created, edited, previewed, and published.
4. An image can be uploaded and inserted into a post.
5. A video larger than 100 MB can be uploaded, inserted, played, and seeked.
6. Publishing triggers GitHub Actions and updates the production blog.
7. Failed uploads can resume at the failed part.
8. Post and media deletion require confirmation.
9. The admin is usable at desktop and mobile widths.

## Required One-time Setup

Implementation requires these owner-authorized account actions:

1. Create an R2 bucket and bind it to the `fuwari` Pages project as `MEDIA_BUCKET`.
2. Create a GitHub OAuth App with the production callback URL.
3. Store the four Cloudflare secrets.
4. Create a least-privilege Cloudflare API token and add the two GitHub repository secrets.

The implementation may automate any of these steps supported by the authenticated local CLI. Any GitHub or Cloudflare screen that requires the owner to grant permissions or copy a newly generated secret will be presented as an explicit handoff.

