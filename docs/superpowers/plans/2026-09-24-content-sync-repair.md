# Content Sync Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: execute this plan task-by-task in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore production content synchronization by fixing the two Astro type errors and deploying the deletion commits to Cloudflare Pages.

**Architecture:** Keep the existing GitHub-backed static content pipeline. Reuse the canonical `PostForList` type at the Svelte boundary, make the theme switch hydration directive type-safe, then build and deploy the generated `dist` directory.

**Tech Stack:** Astro, Svelte, TypeScript, pnpm, Cloudflare Pages/Wrangler

## Global Constraints

- Do not change admin, OAuth, R2, or content-deletion behavior.
- Do not restore any deleted Markdown post.
- Deploy to Cloudflare Pages project `shenwansan-ai-plan` on branch `main`.

---

### Task 1: Fix Astro component typing

**Files:**
- Modify: `src/components/ArchivePanel.svelte`
- Modify: `src/components/Navbar.astro`

**Interfaces:**
- Consumes: `PostForList` from `src/utils/content-utils.ts`
- Produces: `sortedPosts: PostForList[]` for archive filtering and grouping

- [ ] **Step 1: Preserve the failing diagnostic**

Run: `corepack pnpm astro check`

Expected: failure at `Navbar.astro` for `LightDarkSwitch` hydration and at `archive.astro` for nullable `data.category`.

- [ ] **Step 2: Use the canonical article-list type**

Import `PostForList`, type `sortedPosts`, filtered lists, groups, and reducers with it, and remove the narrower local `Post` interface.

- [ ] **Step 3: Correct theme-switch hydration typing**

Replace the failing no-props client-only declaration with Astro's load hydration directive, without changing the switch component or DOM behavior.

- [ ] **Step 4: Verify Astro diagnostics**

Run: `corepack pnpm astro check`

Expected: zero errors; the existing unused `_cssVar` hint may remain.

### Task 2: Verify and publish the production build

**Files:**
- Generated: `dist/` (not committed)

**Interfaces:**
- Consumes: the current `main` branch, including all admin deletion commits
- Produces: a Cloudflare Pages production deployment for `shenwansan-ai-plan`

- [ ] **Step 1: Run regression checks**

Run: `corepack pnpm test:run`, `corepack pnpm type-check:admin`, and `corepack pnpm build`.

Expected: all commands exit with status 0; the build may warn that no Markdown posts exist.

- [ ] **Step 2: Commit and push the repair**

Stage only the two source files and these repair documents, commit with `fix: restore content deployment`, and push `main` to `origin`.

- [ ] **Step 3: Deploy the exact commit**

Run: `corepack pnpm exec wrangler pages deploy dist --project-name shenwansan-ai-plan --branch main --commit-hash <full-commit-sha> --commit-dirty=false`.

Expected: Wrangler returns a successful deployment URL.

- [ ] **Step 4: Verify production**

Fetch the public homepage and `/admin/`.

Expected: the homepage has none of the deleted demo titles and the admin route returns HTTP 200.

