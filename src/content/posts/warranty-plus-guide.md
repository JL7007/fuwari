---
title: 质保 30 天成品 PLUS 使用教程
published: 2026-09-24
updated: 2026-09-24
description: 质保 30 天成品 PLUS 的登录、账号安全、Codex 登录与常见故障排查教程。
image: https://shenwansan-ai-plan.pages.dev/media/images/tutorials/tutorial-2fa-1.png
tags:
  - GPT
  - PLUS
  - Codex
  - 账号安全
  - 使用教程
category: 使用教程
draft: false
lang: 简体中文
---

> [!IMPORTANT]
> 注意事项：ChatGPT 需要自备日本、美国的梯子，可以私聊沈万三获取（请不要在 QQ 群中讨论梯子）。

## 如何使用质保 30 天成品 PLUS 卡密？

密钥格式：**Outlook 邮箱 ＋ Outlook 密码**。登录方法见下方视频；如果第一次没看懂，可以暂停并逐步跟着操作。

**备注：**密钥格式也有可能是：Outlook 邮箱 ＋ GPT 密码 ＋ Outlook 密码。

> [!TIP]
> 一定要增加/修改 GPT 密码，并且添加 2FA 保护。这样才可以保证 GPT 账号的独享性。如果使用 Codex/ChatGPT Work，还需要接国外手机号验证码。

成品 PLUS 登录方法

<video controls preload="metadata" playsinline style="width: 100%; border-radius: 0.75rem;">
  <source src="https://shenwansan-ai-plan.pages.dev/media/videos/tutorials/product-plus-login.mp4" type="video/mp4" />
  你的浏览器不支持视频播放，请直接打开视频链接。
</video>

[直接打开视频](https://shenwansan-ai-plan.pages.dev/media/videos/tutorials/product-plus-login.mp4)

## 如何修改/增加 GPT 密码 + 增加 2FA 保护？

依次打开：**头像 → 设置 → 账号安全与登录**。先增加/修改 GPT 密码，再开启 2FA。

> [!WARNING]
> 2FA 密钥相当于账号安全凭证，请**妥善保存**，不要公开分享。**不要开启 Text message。**

![增加 GPT 密码与 2FA 教程步骤一](https://shenwansan-ai-plan.pages.dev/media/images/tutorials/tutorial-2fa-1.png)

![增加 GPT 密码与 2FA 教程步骤二](https://shenwansan-ai-plan.pages.dev/media/images/tutorials/tutorial-2fa-3.png)

![增加 GPT 密码与 2FA 教程步骤三](https://shenwansan-ai-plan.pages.dev/media/images/tutorials/tutorial-2fa-2.png)

## 如何接国外手机验证码，以便登录 Codex？

- 使用网页版不需要接国外手机验证码。
- 使用 Codex 需要接国外手机验证码。
- 请购买约 1 个月的长效手机验证码。

### 视频教程 02：国外手机号接码教程

<video controls preload="metadata" playsinline style="width: 100%; border-radius: 0.75rem;">
  <source src="https://shenwansan-ai-plan.pages.dev/media/videos/tutorials/phone-verification.mp4" type="video/mp4" />
  你的浏览器不支持视频播放，请直接打开视频链接。
</video>

[直接打开视频](https://shenwansan-ai-plan.pages.dev/media/videos/tutorials/phone-verification.mp4)

## 是否可以在多个终端同时登录账号？

可以同时登录，但是要保证多个终端在同一个 IP 地址，并且终端设备数量不要过多，否则可能引起 OpenAI 风控。

## 可以用多久？用完之后怎么办？

- 这是成品号，不是充到你自己的账号，可使用 30 天，可能有 0～2 天误差。账号到期之后，再买一个成品号即可。
- Codex 对话记录保存在电脑本地。账号到期后更换账号，本地对话记录仍然保留。
- GPT 网页版聊天记录可使用 [ChatMemo](https://chatmemo.ai/) 插件保存。

## 购买之后找不到卡密怎么办？

进入购买店铺的**订单查询**，输入购买时填写的联系方式，以及你自己设置的查询密码。

## 故障排查

以下情况通常不是账号问题。

### 当前节点网络不畅或页面无法连接

需要更换一个畅通的日区或美区节点。IP 要纯净，并尽量保持稳定，不要频繁切换；可以多尝试几次。

![网络节点问题错误示例一](https://shenwansan-ai-plan.pages.dev/media/images/tutorials/network-error-1.png)

![网络节点问题错误示例二](https://shenwansan-ai-plan.pages.dev/media/images/tutorials/network-error-2.png)

### 之前使用中转站或 CC Switch，现在显示 API 报错／无法连接

原因通常是旧配置文件没有更新。需要找到用户目录中的 `.codex` 文件夹，删除旧登录凭证与配置，再重新完成登录流程。

1. 按 <kbd>Win</kbd> + <kbd>R</kbd> 打开“运行”窗口。
2. 粘贴 `%USERPROFILE%\.codex`，然后按回车。
3. 找到 `auth.json`（登录凭证）和 `config.toml`（程序配置），删除后重新登录。

### 登录 Outlook 邮箱多次显示账号或密码错误

登录 Outlook 邮箱时，请先关闭梯子，再重新尝试登录。

![Outlook 邮箱登录错误提示示例](https://shenwansan-ai-plan.pages.dev/media/images/tutorials/outlook-login.png)

### 没有“工作”访问权限？

请更换为 Google 浏览器，使用无痕模式或者清除 Cookie，检查外网环境（请使用日区、美区节点），再登录一次试试。

![没有工作访问权限提示示例](https://shenwansan-ai-plan.pages.dev/media/images/tutorials/work-access-denied.png)
