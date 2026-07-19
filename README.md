# SubGlass

一个部署在 Cloudflare Workers 上的个人订阅转换/管理工具：拉取 sing-box / clash / v2ray 分享链接格式的上游订阅，统一解析后卡片化勾选节点、自定义改名，生成**可持续更新**的订阅链接（clash / sing-box / 通用 v2ray 三种格式都支持），并提供带二维码的展示页方便手机端扫码添加。

## 目录结构

```
src/
  model.ts          统一节点模型 UNode
  util.ts           base64/hash 等工具
  env.ts            Worker 绑定类型
  kv.ts             profile CRUD + 上游内容短缓存
  subscription.ts   拉取上游 -> 合并去重 -> 按选择过滤 -> 应用改名
  index.ts          Worker 路由入口
  parsers/
    uri.ts          vmess/vless/trojan/ss/hysteria2 分享链接 <-> UNode
    clash.ts        clash/mihomo yaml <-> UNode[]
    singbox.ts       sing-box json <-> UNode[]
    detect.ts        自动识别上游格式并统一解析
  render/
    toV2ray.ts       UNode[] -> base64聚合分享链接
    index.ts         按目标格式渲染 + 生成客户端适配所需响应头
public/
  index.html         前端页面
  app.js             前端逻辑（ES Module，import本地vendor的动画库）
  style.css           样式：排版体系 + 材质层级 + reduced-motion 适配
  vendor/
    qrcode.js          本地二维码生成库(qrcode-generator, MIT)
    motion.min.js      本地弹簧动画引擎(用esbuild从framer-motion的DOM入口按需打包, MIT)
```

## 部署步骤

1. 安装依赖
   ```bash
   npm install
   ```

2. 创建 KV namespace
   ```bash
   npx wrangler kv namespace create SUBGLASS_KV
   ```
   将返回的 `id` 填入 `wrangler.toml` 里 `[[kv_namespaces]]` 的 `id` 字段（这个 ID 不敏感，可以提交到仓库）。

3. 设置管理令牌（**`ADMIN_TOKEN` 绝不写进 `wrangler.toml` 或任何会被提交的文件**）
   - 本地开发：复制 `.dev.vars.example` 为 `.dev.vars`，填入真实值。`.dev.vars` 已经在 `.gitignore` 里，不会被提交。
   - CLI 部署：
     ```bash
     npx wrangler secret put ADMIN_TOKEN
     ```
   - 走 GitHub + Cloudflare Dashboard 部署（Workers Builds）：不需要任何本地命令，直接在 Worker 详情页 **Settings → Variables and Secrets** 里手动添加 `ADMIN_TOKEN`，类型选 **Encrypt**。全程不进代码仓库。

   前端「设置」页里要填和这里一致的值。

4. 本地开发
   ```bash
   npm run dev
   ```

5. 部署（本地 CLI 方式）
   ```bash
   npm run deploy
   ```
   或者按上一轮教程连接 GitHub 仓库，用 Cloudflare 网页端的 Workers Builds 自动部署。

6. 打开 Worker 分配到的域名，进入「设置」→ 填写第3步的令牌 → 保存 → 新建订阅方案。

## 使用流程

1. **导入订阅**：粘贴上游订阅链接（一元机场/自建 Xray/sing-box 节点的订阅URL），点击"拉取并添加"。也可以在下方粘贴一段内容做一次性预览（不会持久化）。
2. **节点管理**：勾选要放进最终订阅里的节点，可选填自定义名称，点击"保存勾选与改名"。
3. **我的订阅**：三张卡片对应 Clash/mihomo、sing-box、通用(V2rayN/Shadowrocket/NekoBox等) 三种格式，扫二维码或点击复制按钮拿到订阅链接，填进客户端里。
4. **导出配置**：如果只是想要一份静态配置文件，直接点下载。

## 关键设计说明

- `/s/:id?target=clash|singbox|v2ray` 是核心的动态订阅端点：**每次被客户端拉取时都会重新请求所有上游**（10分钟KV短缓存防止被打爆），所以上游节点变化会自动同步到你已经分发出去的订阅链接，不需要重新生成。
- 该端点公开、无需鉴权（订阅客户端要能直接访问）。`/api/*` 的写操作/内部数据读取需要登录会话：前端在「设置」页用 `ADMIN_TOKEN` 调用一次 `POST /api/login`，成功后服务端签发一个 24 小时有效期的会话 token，通过 `HttpOnly + Secure + SameSite=Strict` Cookie 下发。之后所有请求靠浏览器自动带上这个 Cookie 完成鉴权，前端 JS 全程不持有、也读不到 `ADMIN_TOKEN` 本体或会话 Cookie 的值，会话过期后需要重新登录。
- `/api/login` 有基础的失败次数限流：同一来源 IP 连续失败 5 次会锁定 15 分钟，防止暴力破解 `ADMIN_TOKEN`。
- 上游订阅链接在被拉取前会做基础校验（仅允许 http/https，拒绝 localhost/内网网段/链路本地地址），作为额外一层防御；Cloudflare Workers 边缘本身也会拦截对裸 IP 的直连请求。这不是完整的 SSRF 防护（无法防 DNS rebinding），只作为个人项目场景下合理的成本/收益取舍。
- 节点去重按"类型+服务器+端口+关键凭证"做 hash，同一个节点即使在多个上游里重复出现也只会保留一份。
- 未勾选任何节点时访问订阅链接会返回 409 而不是空文件，避免你误以为订阅"是空的"而不知道要先去节点管理页勾选。

## 设计系统

前端交互按 Apple *Designing Fluid Interfaces* 一套原则重写，核心取舍：

- **弹簧动画而非CSS过渡**：标签页切换、Toast、底部抽屉都用真实弹簧物理（`public/vendor/motion.min.js`，从 `framer-motion` 的 DOM 入口按需 tree-shake 打包出来的 ~62KB 单文件，无需构建工具，`<script type="module">` 直接用）。按钮按下反馈仍然用纯 CSS `:active`——瞬时反馈不需要 JS。
- **移动端底部抽屉导航**：替代了之前"小屏直接隐藏侧边栏、没有替代导航"的缺口。支持拖拽跟手、松手按速度做动量投影决定开合、越界橡皮筋阻力、动画进行中可随时抓取打断重新接力。
- **`prefers-reduced-motion` / `prefers-reduced-transparency` / `prefers-contrast`**：三个媒体查询都做了对应降级（弹簧换瞬时/淡入淡出，毛玻璃换纯色，边框加粗）。
- **排版**：大号数字/标题收紧负字距+紧凑行高，正文字距为0、行高宽松，小号文字轻微正字距——不是全局一个 `letter-spacing` 打天下。
- **材质层级**：侧边栏/移动端顶栏是"结构性"材质（更暗更重的模糊），卡片/面板是"交互性"材质（更亮更轻），两层轻质半透明不叠在一起。
- **破坏性操作的二次确认**：删除上游订阅不用会打断动效连续性的浏览器原生 `confirm()`，改成按钮本身二次点击确认（几秒内不点自动还原）。

## 测试

```bash
npm test        # vitest 单元测试，覆盖5种分享链接协议 + clash/singbox解析器 + 格式自动识别 + 会话鉴权 + 登录限流 + URL安全校验，共51个用例
npm run typecheck
```
