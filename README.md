# SubGlass

SubGlass 是一个运行在 Cloudflare Workers 上的订阅管理工具，用于导入 Clash、sing-box、V2Ray 等订阅内容，选择节点并生成可持续更新的订阅链接。

## 功能

- 支持导入 Clash/Mihomo YAML、sing-box JSON，以及 vmess / vless / trojan / ss / hysteria / hysteria2 / tuic / anytls 分享链接（含整段 base64 编码的订阅内容）
- 导入方式支持两种，都会持久化保存进方案：
  - **可拉取的 https/http 订阅链接**：每次生成订阅时重新拉取最新内容
  - **节点原生格式**：直接粘贴分享链接/yaml/json 文本并保存，内容固定不再变化，适合没有订阅链接、只拿到零散节点的场景
- 节点解析、去重、筛选与自定义重命名，「节点管理」搜索框下方有协议分类标签（VMess/VLess/Trojan/SS/Hysteria/Hysteria2/TUIC/AnyTLS），点击即可按协议类型快速筛选，标签上带实时节点数
- 节点卡片展示详细信息：协议类型、传输层类型(TCP/WebSocket/gRPC/HTTP/QUIC)、TLS/Reality/uTLS指纹标签，以及 SNI、Host、Path、加密方式、拥塞控制等具体参数
- 「设置」页登录后会展示当前账号下的全部方案，卡片式可视化点击切换/删除，不再需要手动记方案ID
- 每个方案可单独设置到期时间：到期后订阅链接直接拒绝访问(HTTP 410)
- 生成 Clash、sing-box、通用 V2Ray 三种订阅格式，均可被客户端持续拉取更新
  - Clash 输出包含"节点选择 / 自动选择 / 故障转移 / 负载均衡"四个策略组
  - sing-box 输出是包含本地 `mixed` 入站(127.0.0.1:2080)和最小 DNS 配置的完整可运行 profile，而不只是 outbounds 片段
- 独立登录页：支持 `ADMIN_USERNAME` + `ADMIN_PASSWORD` 用户名密码登录（推荐），旧版单令牌 `ADMIN_TOKEN` 方式仍兼容，会话通过 24 小时有效期的 HttpOnly Cookie 保存
- KV 缓存上游订阅内容和用户方案
- iOS 风格毛玻璃界面，支持移动端底部抽屉导航
- 自动适配 reduced motion、reduced transparency 和高对比度模式

## 协议兼容性说明

`hysteria`(v1)、`hysteria2`、`tuic`、`anytls` 这四种协议**只有 mihomo(Clash Meta) 内核支持**，原版 Clash 或其他基于旧内核的客户端无法识别这些节点。前端节点卡片会为这四种协议打上「仅mihomo」标签，生成的 Clash YAML 文件开头也会有对应注释提示。如果你的客户端不是 mihomo 内核，请只勾选 vmess/vless/trojan/ss 节点，或改用 sing-box / 通用订阅格式。

`anytls` 额外说明：sing-box 也原生支持该协议（作为 outbound），且 v2rayN 7.14.3+ 已支持 `anytls://` 分享链接；但 **Xray-core 不支持 anytls**，用 Xray-core 内核的客户端（部分 Shadowrocket/v2rayNG 变体）无法使用。

到期时间是真实生效的：每个方案可以在「设置」页单独设置到期时间，过期后 `/s/:id` 订阅链接会直接返回 HTTP 410，客户端拉取不到内容；留空表示永不过期。SubGlass 本身不代理任何流量（只生成配置文件，实际代理连接是客户端和你的上游服务器直接建立的），所以没有提供流量统计或流量配额功能。

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

### 3. 设置登录凭证

在 Worker → Settings → Variables and Secrets 中添加加密变量，两种方式二选一：

**推荐：用户名 + 密码**

```text
ADMIN_USERNAME=你的用户名
ADMIN_PASSWORD=你的密码
```

**旧版兼容：单一令牌**（不推荐用于新部署，登录页用户名留空、密码框填令牌即可）

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
ADMIN_USERNAME=本地开发用户名
ADMIN_PASSWORD=本地开发密码
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

## 部署排错

登录接口返回 HTTP 500 时，响应体里会带具体原因（不是裸的 Cloudflare 错误页），最常见的两种：

- `服务端未配置登录凭证`：去 Cloudflare Dashboard → Worker → Settings → Variables and Secrets 添加 `ADMIN_USERNAME` + `ADMIN_PASSWORD`（或旧版的 `ADMIN_TOKEN`），保存后需要重新部署一次（改配置本身不会自动触发新部署）
- `服务端未绑定 SUBGLASS_KV`：去 Worker → Settings → Bindings 添加一个 KV Namespace 绑定，Variable name 必须精确为 `SUBGLASS_KV`（大小写、下划线都要对上，`wrangler.toml` 里故意没有声明这个绑定，只能在 Dashboard 手动配）

其他未预期的异常也会被顶层兜底捕获，返回 `{"error": "服务端内部错误: ..."}` 而不是让请求裸奔崩溃；如果看到这类信息，把 `error` 里的具体内容发出来会比较好定位。

## 安全说明

- 登录凭证（`ADMIN_USERNAME`+`ADMIN_PASSWORD` 或旧版 `ADMIN_TOKEN`）只通过 Cloudflare Secrets 或本地 `.dev.vars` 配置
- `.dev.vars` 已加入 `.gitignore`
- 上游订阅 URL 会进行基础协议和内网地址校验（SSRF 防护，见 `src/urlSafety.ts`）
- 登录接口有失败次数限流：连续失败 5 次锁定该 IP 15 分钟
- 会话 token 用登录凭证（用户名密码拼接，或旧版令牌）做 HMAC-SHA256 签名，24 小时过期，比较采用恒定时间算法防时序攻击
- 管理接口需要有效会话；写操作的 CSRF 防护依赖 Cookie 的 `SameSite=Strict`（跨站请求不会携带该 Cookie），未额外引入 CSRF token。这个强度对个人后台场景足够，但如果计划把管理界面嵌入其他站点的 iframe，`SameSite=Strict` 会失效，需要另行加固
- `listProfiles` 会自动翻页读取全部 KV 条目，profile 数量增长不会丢数据

## 已知限制

- 未支持 SSR / WireGuard / socks5 / http 代理这几种协议，如有需要可参考现有 parser 结构自行扩展
- sing-box 输出的完整 profile（含 inbounds/dns）是为了兼容需要"完整配置"的客户端；如果你的客户端只需要 outbounds 数组自行合并模板，读取该字段即可，其余字段可忽略
- 没有真实的流量统计，`Subscription-Userinfo` 响应头里的流量数字固定返回"无限流量"占位值；到期时间(`expire` 字段)是真实的，取自方案设置
