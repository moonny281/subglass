# SubGlass

一个部署在 Cloudflare Workers 上的个人订阅转换/管理工具：拉取 sing-box / clash / v2ray 分享链接格式的上游订阅，统一解析后卡片化勾选节点、自定义改名，生成**可持续更新**的订阅链接（clash / sing-box / 通用 v2ray 三种格式都支持），并提供带二维码的展示页方便手机端扫码添加。

## 🚀 特性

- **多格式支持**：自动识别并解析 Clash/Mihomo YAML、Sing-box JSON、VMess/VLESS/Trojan/SS/Hysteria2 分享链接
- **统一节点模型**：所有格式统一转换为 `UNode`，避免 N×N 转换复杂度
- **订阅持续更新**：生成的订阅链接无需重新生成，上游节点变化会自动同步
- **节点去重**：按「类型+服务器+端口+关键凭证」Hash，多上游重复节点只保留一份
- **灵活勾选**：卡片化界面勾选/改名节点，支持批量全选/全不选
- **二维码展示**：生成可扫描的订阅二维码，方便手机端客户端添加
- **会话鉴权**：HMAC签名 + HttpOnly Cookie，24小时自动过期
- **短期缓存**：上游订阅内容 10 分钟 KV 缓存，防止被高频拉取打爆
- **开箱即用**：无需构建前端，静态资源直接部署到 Workers

## 📦 目录结构

```
subglass/
├── wrangler.toml              Worker 部署配置
├── package.json
├── tsconfig.json
├── .gitignore
├── .dev.vars.example          本地开发环境变量示例
├── README.md
│
├── src/
│   ├── index.ts                Worker 路由入口
│   ├── env.ts                  Worker 绑定类型定义
│   ├── model.ts                UNode、Profile 等核心类型
│   ├── util.ts                 base64/hash/恒定时间比较等工具
│   ├── auth.ts                 HMAC 会话 token 管理
│   ├── auth.test.ts            会话认证测试
│   ├── kv.ts                   Profile CRUD + 上游缓存
│   ├── subscription.ts         上游拉取、合并、过滤
│   │
│   ├── parsers/
│   │   ├── uri.ts              分享链接解析/编码
│   │   ├── uri.test.ts         分享链接测试
│   │   ├── clash.ts            Clash YAML 解析/编码
│   │   ├── clash.test.ts       Clash 测试
│   │   ├── singbox.ts          Sing-box JSON 解析/编码
│   │   ├── singbox.test.ts     Sing-box 测试
│   │   ├── detect.ts           格式自动识别
│   │   └── detect.test.ts      格式识别测试
│   │
│   └── render/
│       ├── index.ts            订阅渲染分发
│       └── toV2ray.ts          V2ray 分享链接聚合格式
│
└── public/
    ├── index.html              前端页面
    ├── app.js                  前端逻辑
    ├── style.css               毛玻璃风格样式
    └── vendor/
        └── qrcode.js           二维码生成库
```

## 🛠️ 部署步骤

### 1. 安装依赖

```bash
npm install
```

### 2. 创建 KV 命名空间

```bash
npx wrangler kv:namespace create SUBGLASS_KV
```

将返回的 `id` 填入 `wrangler.toml` 里的 `[[kv_namespaces]]` 配置：

```toml
[[kv_namespaces]]
binding = "SUBGLASS_KV"
id = "你的_KV_namespace_id"
```

### 3. 设置管理令牌

**⚠️ ADMIN_TOKEN 绝不写进 wrangler.toml 或任何会被提交的文件**

#### 本地开发

复制 `.dev.vars.example` 为 `.dev.vars`，填入真实值：

```bash
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入 ADMIN_TOKEN=your_secret_token
```

（`.dev.vars` 已在 `.gitignore` 中，不会被提交）

#### CLI 部署

```bash
npx wrangler secret put ADMIN_TOKEN
# 交互式输入令牌值
```

#### 通过 Dashboard 部署

不需要本地命令，直接在 Cloudflare Dashboard 中：
1. Workers → 选中本 Worker
2. Settings → Variables and Secrets
3. 添加环境变量 `ADMIN_TOKEN`，类型选 **Encrypt**

### 4. 本地开发

```bash
npm run dev
# 访问 http://localhost:8787
```

### 5. 部署

#### CLI 方式

```bash
npm run deploy
```

#### GitHub + Cloudflare Dashboard 自动部署

1. 连接本仓库到 Cloudflare Workers Builds
2. 在 Dashboard 配置环境变量 `ADMIN_TOKEN`
3. 每次 push 自动部署

### 6. 首次使用

1. 打开 Worker 分配的域名
2. 进入「⚙️ 设置」
3. 填写第 3 步的 `ADMIN_TOKEN` 并登录
4. 新建或加载订阅方案

## 📖 使用流程

### 1️⃣ 导入订阅

- 进入「📥 导入订阅」
- 填写上游标签（如「机场 A」）和订阅链接 URL
- 点击「拉取并添加」
- 支持 Clash YAML、Sing-box JSON、分享链接三种格式
- 也可以粘贴一段内容做一次性预览（不会持久化）

### 2️⃣ 节点管理

- 进入「🧩 节点管理」
- 卡片化显示所有已拉取的节点（带去重）
- 勾选要包含的节点
- 可选填「自定义名称」覆盖原节点名
- 点击「保存勾选与改名」

### 3️⃣ 我的订阅

- 进入「📡 我的订阅」
- 三种格式卡片，各有二维码和复制按钮
- 使用二维码或复制链接添加到客户端

### 4️⃣ 导出配置

- 进入「📤 导出配置」
- 直接下载配置文件（一次性，不含自动更新功能）

## 🔐 安全设计

### 令牌处理

- **前端永不持有** ADMIN_TOKEN 本体
- 登录时一次性上传 token，交换 24 小时有效期会话凭证
- 会话凭证通过 **HttpOnly Cookie** 下发，JavaScript 无法读取

### Cookie 属性

```
Secure        # 仅 HTTPS 传输（本地开发自动禁用）
HttpOnly       # JS 无法访问
SameSite=Strict # 防 CSRF
Max-Age=86400 # 24 小时自动过期
```

### 订阅端点

- `/s/:id?target=clash|singbox|v2ray` **公开无鉴权**（订阅客户端需要访问）
- `/api/*` **所有写操作需要会话鉴权**
- 节点去重防止信息泄露

## 🔄 节点去重算法

使用 FNV-1a 32 位 hash，按以下字段生成稳定 ID：

```
ID = hash("type|server|port|关键凭证")
```

示例：
- VMESS: `"vmess|example.com|443|uuid"`
- SS: `"ss|example.com|8388|aes-256-gcm:password"`
- Trojan: `"trojan|example.com|443|password"`

同一节点即使在多个上游里重复出现，也只会保留一份（后出现的覆盖先出现的）。

## 📤 动态订阅工作流

```
客户端发起请求
        ↓
  GET /s/profile-id?target=clash
        ↓
  后端检查 Profile.selectedIds 是否为空
        ↓
  ┌─ 不为空 ───┐
  │            │
  ↓            ↓
重新拉取      返回 409
所有上游     （需要先选节点）
  │
  ├→ 缓存命中 → 秒速返回
  │    (10分钟TTL)
  │
  └→ 缓存未命中
        │
        ↓
    并发拉取
    所有上游链接
        │
        ├→ 某上游失败
        │  日志记录
        │  继续处理其他上游
        │
        └→ 解析 + 去重
             ↓
          应用选择过滤
             ↓
          应用自定义改名
             ↓
          渲染为目标格式
             ↓
        缓存 + 返回客户端
```

## 🧪 测试

```bash
# 运行所有测试
npm test

# 类型检查
npm run typecheck
```

### 测试覆盖

- ✅ HMAC 会话签名与验证（过期检测、篡改检测）
- ✅ 5 种分享链接协议（VMess、VLESS、Trojan、SS、Hysteria2）
- ✅ Clash YAML 解析/编码
- ✅ Sing-box JSON 解析/编码
- ✅ 格式自动识别（包含 base64 订阅格式）
- ✅ 节点去重（ID 碰撞合并）
- ✅ 往返转换（Parse → Encode → Parse 一致性）

共 **40+ 个单元测试用例**。

## 🎨 前端技术栈

- 纯 HTML + CSS + JavaScript（无框架依赖）
- 毛玻璃风格 UI（backdrop-filter）
- 响应式布局（移动端友好）
- 本地二维码生成（qrcode-generator, MIT）
- 会话状态管理（localStorage + 内存 state）

## 📝 核心 API 端点

### 公开端点

```
GET  /s/:id                    订阅内容（自动格式识别）
GET  /s/:id?target=clash       Clash 格式
GET  /s/:id?target=singbox     Sing-box 格式
GET  /s/:id?target=v2ray       V2ray 聚合分享链接
```

### 认证端点（需登录）

```
POST /api/login                用 ADMIN_TOKEN 登录，获取会话 Cookie
POST /api/logout               登出
GET  /api/session              检查会话状态

POST /api/profile              新建订阅方案
GET  /api/profile/:id          读取方案详情
PUT  /api/profile/:id          更新方案（上游/选择/改名）
DEL  /api/profile/:id          删除方案

GET  /api/profile/:id/pool     获取完整节点池
GET  /api/profile/:id/summary  获取订阅链接 + 统计

POST /api/import               验证并预览订阅内容
```

## 📋 环境变量

### 必需

- `ADMIN_TOKEN`: 管理员令牌（强烈推荐 32 字符以上随机字符串）

### 自动绑定（wrangler.toml）

- `SUBGLASS_KV`: Cloudflare KV 命名空间
- `ASSETS`: 前端静态资源绑定

## 🔗 依赖

### 生产依赖

- `js-yaml`: YAML 解析

### 开发依赖

- `typescript`: 类型检查
- `vitest`: 单元测试框架
- `wrangler`: Cloudflare Workers CLI
- `@cloudflare/workers-types`: Workers 类型定义

## 📄 许可证

MIT License

## 🤝 贡献

Issues 和 Pull Requests 欢迎！

## ⚠️ 免责声明

- 本工具仅用于个人订阅管理，用户需自行承担使用本工具对上游订阅链接进行的操作所产生的一切后果
- 不对上游链接的合法性、可用性、安全性做任何保证
- 请勿用于商业目的或批量分发他人订阅
