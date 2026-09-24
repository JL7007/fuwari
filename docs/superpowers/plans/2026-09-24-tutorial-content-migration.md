# Tutorial Content Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Execute this plan inline in the current session. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish two Chinese tutorial posts containing all source FAQs, images, and videos from `shenwansan-ai.pages.dev`.

**Architecture:** Upload the four MP4 files and seven source images to the existing Cloudflare R2 bucket `fuwari-media`. Create two Markdown entries under `src/content/posts`, use the R2 public URLs for all media, then build and deploy the static Fuwari site to Cloudflare Pages.

**Tech Stack:** Astro 5, Markdown, Cloudflare R2, Wrangler 4, Cloudflare Pages, pnpm

## Global Constraints

- Preserve the original Chinese tutorial wording and external URLs.
- Publish exactly two articles: `warranty-plus-guide` and `direct-plus-guide`.
- Upload source media from `C:\Users\lijia40\Documents\网站部署\assets` to Cloudflare rather than committing videos to GitHub.
- Do not alter or delete the source site.

---

### Task 1: Upload tutorial media to Cloudflare R2

**Files:**
- Source: `C:\Users\lijia40\Documents\网站部署\assets\videos\product-plus-login.mp4`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\videos\phone-verification.mp4`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\videos\qq-email-register.mp4`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\videos\free-to-plus-upgrade.mp4`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\images\tutorial-2fa-1.png`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\images\tutorial-2fa-2.png`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\images\tutorial-2fa-3.png`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\images\network-error-1.png`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\images\network-error-2.png`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\images\outlook-login.png`
- Source: `C:\Users\lijia40\Documents\网站部署\assets\images\work-access-denied.png`

**Interfaces:**
- Consumes: local source assets and the configured Wrangler account.
- Produces: public URLs under `https://shenwansan-ai-plan.pages.dev/media/tutorials/`.

- [ ] **Step 1: Verify exact source asset names and sizes**

Run: `Get-ChildItem -File ..\assets\videos, ..\assets\images | Select-Object FullName,Length`

Expected: four MP4 files and seven required image files are readable.

- [ ] **Step 2: Upload files with stable tutorial paths**

Run one `wrangler r2 object put` command per asset using the `fuwari-media` bucket and paths prefixed by `tutorials/`.

Expected: every command reports a successful upload.

- [ ] **Step 3: Verify the public media URLs**

Fetch every generated `https://shenwansan-ai-plan.pages.dev/media/tutorials/<file>` URL.

Expected: all URLs respond HTTP 200.

### Task 2: Create the two published tutorial posts

**Files:**
- Create: `src/content/posts/warranty-plus-guide.md`
- Create: `src/content/posts/direct-plus-guide.md`

**Interfaces:**
- Consumes: R2 media URLs from Task 1.
- Produces: two valid `posts` collection entries with required frontmatter and Markdown body.

- [ ] **Step 1: Write warranty-plus-guide.md**

Use frontmatter with `title: "质保 30 天成品 PLUS 使用教程"`, `published: 2026-09-24`, `category: "使用教程"`, and tags for GPT, PLUS, Codex, and account security. Include all ten specified FAQ and troubleshooting headings, both videos, and all seven images.

- [ ] **Step 2: Write direct-plus-guide.md**

Use frontmatter with `title: "代充 GPT PLUS 使用教程"`, `published: 2026-09-24`, `category: "使用教程"`, and tags for GPT, PLUS, account registration, and upgrade. Include the two specified headings and both videos.

- [ ] **Step 3: Validate article coverage**

Run: `rg -n "如何使用质保|没有“工作”访问权限|如何注册 GPT Free|如何将 GPT Free" src/content/posts/*-guide.md`

Expected: all four anchor headings appear in the two article files.

### Task 3: Verify, publish, and deploy

**Files:**
- Generated: `dist/`

**Interfaces:**
- Consumes: the two Markdown files and R2 public media URLs.
- Produces: production routes `/posts/warranty-plus-guide/` and `/posts/direct-plus-guide/`.

- [ ] **Step 1: Run checks and production build**

Run: `corepack pnpm test:run`, `corepack pnpm type-check:admin`, `corepack pnpm astro check`, and `corepack pnpm build`.

Expected: all commands exit with status 0 and the build reports both article routes.

- [ ] **Step 2: Commit and push**

Run: `git add src/content/posts/warranty-plus-guide.md src/content/posts/direct-plus-guide.md docs/superpowers && git commit -m "content: migrate plus tutorials" && git push origin main`.

Expected: the new commit is accepted by `origin/main`.

- [ ] **Step 3: Deploy the exact commit**

Run: `corepack pnpm exec wrangler pages deploy dist --project-name shenwansan-ai-plan --branch main --commit-hash <commit-sha> --commit-dirty=false`.

Expected: Wrangler returns a successful Pages deployment URL.

- [ ] **Step 4: Verify public routes**

Fetch both production post URLs and verify their main headings and embedded media links.

Expected: both routes return HTTP 200 and contain their expected titles.
