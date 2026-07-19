# SubGlass

SubGlass 是一个运行在 Cloudflare Workers 上的订阅管理工具，用于导入 Clash、sing-box、V2Ray 等订阅内容，选择节点并生成可持续更新的订阅链接。

## 功能

- 支持 Clash/Mihomo YAML、sing-box JSON、vmess、vless、trojan、ss、hysteria2
- 节点解析、去重、筛选与自定义重命名
- 生成 Clash、sing-box、通用 V2Ray 三种订阅格式
- 管理后台使用 `ADMIN_TOKEN` 登录，并通过 HttpOnly Cookie 保存会话
- KV 缓存上游订阅内容和用户方案
- iOS 风格毛玻璃界面，支持移动端底部抽屉导航
- 自动适配 reduced motion、reduced transparency 和高对比度模式

## 技术栈

- Cloudflare Workers
- Cloudflare KV
- TypeScript
- Wrangler 4
- 原生 HTML/CSS/JavaScript 前端

## Cloudflare 部署

### 1. 创建 Worker

将 GitHub 仓库连接到 Cloudflare Workers Builds，生产分支选择 `main`，根目录选择仓库根目录。

部署命令：

```bash
npm ci
npx wrangler deploy
```

### 2. 绑定 KV

KV 不写入 `wrangler.toml`，由每个 Cloudflare 环境自行绑定：

1. 打开 Worker → Settings → Bindings
2. 添加 KV Namespace
3. Variable name 填写 `SUBGLASS_KV`
4. 选择目标 KV 命名空间并保存

### 3. 设置管理令牌

在 Worker → Settings → Variables and Secrets 中添加加密变量：

```text
ADMIN_TOKEN=你的管理令牌
```

不要将真实令牌写入代码、`wrangler.toml` 或 GitHub 仓库。

### 4. 自动部署

仓库包含 `.github/workflows/deploy.yml`。每次推送到 `main` 时，GitHub Actions 会执行类型检查并部署 Worker。

在 GitHub → Settings → Secrets and variables → Actions 中添加：

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
```

API Token 至少需要该 Cloudflare 账号的 Workers 部署权限。

## 本地开发

安装依赖：

```bash
npm install
```

创建 `.dev.vars`：

```text
ADMIN_TOKEN=本地开发令牌
```

启动开发服务器：

```bash
npm run dev
```

本地开发还需要通过 Wrangler 配置本地 KV，或在测试环境中提供名为 `SUBGLASS_KV` 的 KV 绑定。

## 检查命令

```bash
npm run typecheck
npm test
```

## Logo 与网页图标

当前品牌 Logo 位于 `public/logo.svg`，网页通过 favicon 和 Apple Touch Icon 引用该文件，避免浏览器显示默认地球图标。

## 安全说明

- `ADMIN_TOKEN` 只通过 Cloudflare Secrets 或本地 `.dev.vars` 配置
- `.dev.vars` 已加入 `.gitignore`
- 上游订阅 URL 会进行基础协议和内网地址校验
- 管理接口需要有效会话
