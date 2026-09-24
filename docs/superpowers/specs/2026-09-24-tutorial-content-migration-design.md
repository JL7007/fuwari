# Tutorial Content Migration Design

## Goal

Move all tutorial content from `https://shenwansan-ai.pages.dev/` into the blog at `https://shenwansan-ai-plan.pages.dev/` as two published Chinese tutorial articles.

## Selected structure

### Article 1: 质保 30 天成品 PLUS 使用教程

Slug: `warranty-plus-guide`

Includes the original notice, six usage and account questions, four troubleshooting questions, two videos, and seven instructional images:

1. 如何使用质保 30 天成品 PLUS 卡密？
2. 如何修改/增加 GPT 密码 + 增加 2FA 保护
3. 如何接国外手机验证码，以便登录 Codex？
4. 是否可以在多个终端同时登录账号？
5. 可以用多久？用完之后怎么办？
6. 购买之后找不到卡密怎么办？
7. 当前节点网络不畅或页面无法连接
8. 之前使用中转站或 CC Switch，现在显示 API 报错／无法连接
9. 登录 Outlook 邮箱多次显示账号或密码错误
10. 没有“工作”访问权限？

### Article 2: 代充 GPT PLUS 使用教程

Slug: `direct-plus-guide`

Includes the original prerequisites, two questions, and two instructional videos:

1. 如何注册 GPT Free 账号？
2. 如何将 GPT Free 升级为 PLUS/Pro

## Content and media rules

- Preserve the original Chinese wording and external links; reorganize it into readable Markdown headings, lists, callouts, and embedded videos.
- Publish both articles immediately in the `使用教程` category with relevant tags.
- Upload four MP4 files and seven image files to the existing Cloudflare R2 media bucket, then use their public media URLs in the articles.
- Do not include source website CSS, JavaScript, tabs, or FAQ accordion behavior; the Fuwari blog theme supplies article layout and media playback.
- Do not delete or alter the source website.

## Verification

- Both article source files exist and contain every listed question.
- Every copied R2 media URL responds successfully.
- A production build completes and generates both article routes.
- Both public article pages return HTTP 200 after deployment.
