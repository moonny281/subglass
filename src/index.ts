import type { Env } from "./env";
import type { Profile, TargetFormat, ImportSource } from "./model";
import { getProfile, putProfile, deleteProfile, listProfiles, newProfile, markTargetGenerated } from "./kv";
import { buildNodePool, buildSelectedNodes, NoNodesSelectedError } from "./subscription";
import { renderSubscription } from "./render";
import { parseSubscription } from "./parsers/detect";
import {
  createSessionToken,
  verifySessionToken,
  getSessionTokenFromRequest,
  buildSetCookieHeader,
  buildClearCookieHeader,
  SESSION_TTL_SECONDS,
} from "./auth";
import { timingSafeEqual } from "./util";
import { assertSafeUpstreamUrl } from "./urlSafety";
import { checkLoginRateLimit, recordLoginAttempt } from "./ratelimit";

const TARGETS: TargetFormat[] = ["clash", "singbox", "v2ray"];

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function errorJson(message: string, status = 400): Response {
  return json({ error: message }, status);
}

/** 校验请求携带的会话 Cookie 是否有效（登录后的短期凭证，而非原始 ADMIN_TOKEN） */
async function isAuthed(req: Request, env: Env): Promise<boolean> {
  if (!env.ADMIN_TOKEN) return false;
  const sessionToken = getSessionTokenFromRequest(req);
  if (!sessionToken) return false;
  return verifySessionToken(sessionToken, env.ADMIN_TOKEN);
}

async function requireAuth(req: Request, env: Env): Promise<Response | null> {
  if (!(await isAuthed(req, env))) return errorJson("未登录或会话已过期，请重新登录", 401);
  return null;
}

/**
 * 部署配置自检：ADMIN_TOKEN 和 SUBGLASS_KV 都需要在 Cloudflare Dashboard 里手动配置
 * (不在 wrangler.toml 里)，很容易漏配。漏配时如果不提前检查，后面代码会因为对
 * undefined 取属性/调用方法而抛出未捕获异常，最终只会看到一个不知所云的 HTTP 500。
 * 这里提前检查并给出明确的报错信息，方便定位到底是哪一步没配置。
 */
function checkDeployConfig(env: Env): string | null {
  if (!env.ADMIN_TOKEN) {
    return "服务端未配置 ADMIN_TOKEN：请在 Cloudflare Dashboard → Worker → Settings → Variables and Secrets 中添加 ADMIN_TOKEN（类型选 Secret/Encrypt），保存后需要重新部署或触发一次新的部署才会生效。";
  }
  if (!env.SUBGLASS_KV) {
    return "服务端未绑定 SUBGLASS_KV：请在 Cloudflare Dashboard → Worker → Settings → Bindings 中添加一个 KV Namespace 绑定，Variable name 必须精确填写 SUBGLASS_KV（大小写和下划线都要对上）。";
  }
  return null;
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const configError = checkDeployConfig(env);
  if (configError) return errorJson(configError, 500);

  const ip = req.headers.get("CF-Connecting-IP") || "unknown";

  const gate = await checkLoginRateLimit(env, ip);
  if (!gate.allowed) {
    return errorJson(`登录尝试过多，请 ${gate.retryAfterSeconds} 秒后再试`, 429);
  }

  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const provided = body.token || "";
  // 恒定时间比较，避免通过响应耗时差异被猜出 ADMIN_TOKEN
  const valid = provided.length > 0 && timingSafeEqual(provided, env.ADMIN_TOKEN);
  await recordLoginAttempt(env, ip, valid);

  if (!valid) {
    return errorJson("令牌不正确", 401);
  }
  const { token, expiresAt } = await createSessionToken(env.ADMIN_TOKEN);
  return json(
    { ok: true, expiresAt },
    200,
    { "Set-Cookie": buildSetCookieHeader(req, token, SESSION_TTL_SECONDS) },
  );
}

async function handleLogout(req: Request): Promise<Response> {
  return json({ ok: true }, 200, { "Set-Cookie": buildClearCookieHeader(req) });
}

async function handleSessionCheck(req: Request, env: Env): Promise<Response> {
  const authed = await isAuthed(req, env);
  return json({ authenticated: authed });
}

/** 校验 target 查询参数是否合法 */
function parseTarget(value: string | null): TargetFormat | null {
  if (value && (TARGETS as string[]).includes(value)) return value as TargetFormat;
  return null;
}

async function handleImport(req: Request): Promise<Response> {
  const body = (await req.json()) as { url?: string; text?: string };
  let raw: string;
  if (body.url) {
    try {
      assertSafeUpstreamUrl(body.url);
    } catch (e) {
      return errorJson((e as Error).message, 400);
    }
    if (!/^https?:/i.test(body.url)) {
      raw = body.url;
    } else {
    const resp = await fetch(body.url, { headers: { "User-Agent": "SubGlass/1.0" } });
    if (!resp.ok) return errorJson(`拉取上游失败: HTTP ${resp.status}`, 502);
    raw = await resp.text();
    }
  } else if (body.text) {
    raw = body.text;
  } else {
    return errorJson("请提供 url 或 text 字段之一");
  }

  const nodes = parseSubscription(raw);
  if (nodes.length === 0) return errorJson("未能从内容中解析出任何有效节点，请检查格式", 422);
  return json({ nodes, count: nodes.length });
}

async function handleCreateProfile(req: Request, env: Env): Promise<Response> {
  const body = (await req.json().catch(() => ({}))) as {
    name?: string;
    upstreams?: { label: string; url?: string; content?: string }[];
  };
  const profile = newProfile(body.name || "我的订阅");
  if (body.upstreams?.length) {
    profile.upstreams = body.upstreams.map((u) => ({
      id: crypto.randomUUID(),
      label: u.label,
      type: u.content !== undefined ? "raw" : "url",
      url: u.content === undefined ? u.url : undefined,
      content: u.content,
      addedAt: Date.now(),
    }));
  }
  await putProfile(env, profile);
  return json(profile, 201);
}

async function handleGetProfile(env: Env, id: string): Promise<Response> {
  const profile = await getProfile(env, id);
  if (!profile) return errorJson("profile 不存在", 404);
  return json(profile);
}

async function handleListProfiles(env: Env): Promise<Response> {
  const profiles = await listProfiles(env);
  return json({ profiles });
}

interface ProfilePatch {
  name?: string;
  upstreams?: ImportSource[];
  addUpstream?: { label: string; url?: string; content?: string };
  selectedIds?: string[];
  renameMap?: Record<string, string>;
}

async function handleUpdateProfile(req: Request, env: Env, id: string): Promise<Response> {
  const profile = await getProfile(env, id);
  if (!profile) return errorJson("profile 不存在", 404);

  const patch = (await req.json().catch(() => ({}))) as ProfilePatch;
  if (patch.name !== undefined) profile.name = patch.name;
  if (patch.upstreams !== undefined) profile.upstreams = patch.upstreams;
  if (patch.addUpstream) {
    const { label, url, content } = patch.addUpstream;
    if (content === undefined && !url) return errorJson("请提供 url 或 content 字段之一", 400);
    profile.upstreams.push({
      id: crypto.randomUUID(),
      label,
      type: content !== undefined ? "raw" : "url",
      url: content === undefined ? url : undefined,
      content,
      addedAt: Date.now(),
    });
  }
  if (patch.selectedIds !== undefined) profile.selectedIds = patch.selectedIds;
  if (patch.renameMap !== undefined) profile.renameMap = { ...profile.renameMap, ...patch.renameMap };
  profile.updatedAt = Date.now();

  await putProfile(env, profile);
  return json(profile);
}

async function handleDeleteProfile(env: Env, id: string): Promise<Response> {
  await deleteProfile(env, id);
  return json({ ok: true });
}

/** 返回该 profile 完整节点池，供前端卡片化勾选界面使用 */
async function handlePool(env: Env, id: string): Promise<Response> {
  const profile = await getProfile(env, id);
  if (!profile) return errorJson("profile 不存在", 404);
  try {
    const pool = await buildNodePool(env, profile);
    return json({ nodes: pool, selectedIds: profile.selectedIds, renameMap: profile.renameMap });
  } catch (e) {
    return errorJson((e as Error).message, 502);
  }
}

/** 公开的订阅链接展示信息：名称、节点数、各格式订阅URL（用于展示页+二维码，不含敏感操作） */
async function handleSummary(env: Env, id: string, origin: string): Promise<Response> {
  const profile = await getProfile(env, id);
  if (!profile) return errorJson("profile 不存在", 404);

  const labels: Record<TargetFormat, string> = {
    clash: "Clash / Mihomo",
    singbox: "sing-box",
    v2ray: "通用 (V2rayN / Shadowrocket / NekoBox 等)",
  };
  const links = TARGETS.map((target) => ({
    target,
    label: labels[target],
    url: `${origin}/s/${profile.id}?target=${target}`,
  }));

  return json({
    id: profile.id,
    name: profile.name,
    nodeCount: profile.selectedIds.length,
    updatedAt: profile.updatedAt,
    links,
  });
}

/** 核心：动态订阅端点。每次请求都重新拉取上游(短TTL缓存)并实时转换，天然"可更新" */
async function handleSubscribe(env: Env, id: string, target: TargetFormat): Promise<Response> {
  const profile = await getProfile(env, id);
  if (!profile) return new Response("订阅不存在", { status: 404 });

  try {
    const nodes = await buildSelectedNodes(env, profile);
    const result = renderSubscription(nodes, target, profile.name);

    markTargetGenerated(profile, target);
    await putProfile(env, profile); // 记录该格式已被使用过，供展示页/统计用

    return new Response(result.body, {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        ...result.extraHeaders,
      },
    });
  } catch (e) {
    if (e instanceof NoNodesSelectedError) {
      return new Response(e.message, { status: 409, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    return new Response((e as Error).message, { status: 502, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    try {
      return await route(req, env);
    } catch (e) {
      // 兜底：任何未被内部 try/catch 捕获的异常（多半是漏配了 ADMIN_TOKEN / SUBGLASS_KV
      // 绑定，或是访问了 undefined 属性）都在这里统一处理，返回可读的错误信息，
      // 而不是让 Cloudflare 直接抛出一个不带任何上下文的裸 HTTP 500 页面。
      console.error("未捕获的异常:", e);
      return errorJson(`服务端内部错误: ${(e as Error).message || "unknown"}`, 500);
    }
  },
};

async function route(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  // --- 公开订阅端点：客户端直接拉取，无需鉴权 ---
  if (pathname.startsWith("/s/")) {
    const id = pathname.slice("/s/".length);
    const target = parseTarget(url.searchParams.get("target"));
    if (!target) return errorJson("缺少或非法的 target 参数 (clash|singbox|v2ray)", 400);
    return handleSubscribe(env, id, target);
  }

  // --- 展示页公开摘要信息(订阅链接+节点数)，同样无需鉴权，方便二维码分享页直接读取 ---
  const summaryMatch = pathname.match(/^\/api\/profile\/([^/]+)\/summary$/);
  if (summaryMatch && req.method === "GET") {
    return handleSummary(env, summaryMatch[1], url.origin);
  }

  // --- 登录/登出/会话检查：本身不需要已登录，login内部会校验ADMIN_TOKEN ---
  if (pathname === "/api/login" && req.method === "POST") return handleLogin(req, env);
  if (pathname === "/api/logout" && req.method === "POST") return handleLogout(req);
  if (pathname === "/api/session" && req.method === "GET") return handleSessionCheck(req, env);

  // --- 以下 /api/* 写操作与内部数据读取均需已登录会话 ---
  if (pathname.startsWith("/api/")) {
    const authFail = await requireAuth(req, env);
    if (authFail) return authFail;

    if (pathname === "/api/import" && req.method === "POST") return handleImport(req);
    if (pathname === "/api/profile" && req.method === "POST") return handleCreateProfile(req, env);
    if (pathname === "/api/profiles" && req.method === "GET") return handleListProfiles(env);

    const poolMatch = pathname.match(/^\/api\/profile\/([^/]+)\/pool$/);
    if (poolMatch && req.method === "GET") return handlePool(env, poolMatch[1]);

    const idMatch = pathname.match(/^\/api\/profile\/([^/]+)$/);
    if (idMatch) {
      const id = idMatch[1];
      if (req.method === "GET") return handleGetProfile(env, id);
      if (req.method === "PUT") return handleUpdateProfile(req, env, id);
      if (req.method === "DELETE") return handleDeleteProfile(env, id);
    }

    return errorJson("未找到该API路径", 404);
  }

  // --- 其余请求交给静态资源(前端页面) ---
  return env.ASSETS.fetch(req);
}
