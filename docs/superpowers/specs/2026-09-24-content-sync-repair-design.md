# Content Sync Repair Design

## Problem

The admin successfully deleted the Markdown posts from GitHub, but the public site still shows the previous demo content. The latest GitHub Actions run stops during Astro type checking, so Cloudflare Pages never receives a new production build.

## Approaches considered

1. **Repair the two type errors and keep the existing static deployment flow (selected).** This preserves the current GitHub-backed admin, produces a new static build after every content change, and has the smallest regression surface.
2. Disable Astro checking in CI. This would deploy quickly but would hide real type incompatibilities and allow future broken builds.
3. Change the frontend to read posts dynamically from an API. This would remove rebuild latency, but it is a large architecture change and is unnecessary for the current issue.

## Design

- `ArchivePanel.svelte` will consume the existing `PostForList` type exported by `src/utils/content-utils.ts`, so nullable categories match the content schema.
- `Navbar.astro` will hydrate the no-props theme switch with a directive accepted by Astro's type checker while keeping its browser behavior unchanged.
- No content, authentication, upload, R2, or admin API behavior will change.
- Validation will run the project tests, admin TypeScript check, Astro check, and production build.
- The resulting commit will be pushed to `main` and deployed manually to the Cloudflare Pages project `shenwansan-ai-plan` so the public site updates immediately. CI deployment credentials remain a separate repository-secret concern.

## Success criteria

- Astro reports zero errors.
- The production build completes with an empty posts collection.
- `https://shenwansan-ai-plan.pages.dev/` no longer contains the deleted demo post titles.
- The admin route remains reachable.

