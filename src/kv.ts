import type { Env } from "./env";
import type { Profile, TargetFormat } from "./model";
import { assertSafeUpstreamUrl } from "./urlSafety";

const PROFILE_PREFIX = "profile:";
const CACHE_PREFIX = "cache:";
const UPSTREAM_CACHE_TTL_SECONDS = 600; // 10分钟，防止上游被高频拉取的客户端打爆

/**
 * 兼容旧数据：早期版本的 ImportSource 没有 type 字段，永远都是可拉取的 url。
 * 这里在读取时补全，避免新代码假设 type 一定存在而出错。
 */
function normalizeProfile(profile: Profile): Profile {
  profile.upstreams = profile.upstreams.map((u) => (u.type ? u : { ...u, type: "url" as const }));
  if (!profile.chains) profile.chains = [];
  return profile;
}

export async function getProfile(env: Env, id: string): Promise<Profile | null> {
  const raw = await env.SUBGLASS_KV.get(PROFILE_PREFIX + id);
  return raw ? normalizeProfile(JSON.parse(raw) as Profile) : null;
}

export async function putProfile(env: Env, profile: Profile): Promise<void> {
  await env.SUBGLASS_KV.put(PROFILE_PREFIX + profile.id, JSON.stringify(profile));
}

export async function deleteProfile(env: Env, id: string): Promise<void> {
  await env.SUBGLASS_KV.delete(PROFILE_PREFIX + id);
}

/** 列出所有 profile（后台展示页用）。KV list 单次最多返回1000条，这里循环游标直到取完，避免数据量增长后静默丢失 */
export async function listProfiles(env: Env): Promise<Profile[]> {
  const keyNames: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.SUBGLASS_KV.list({ prefix: PROFILE_PREFIX, cursor });
    keyNames.push(...page.keys.map((k) => k.name));
    if (page.list_complete) break;
    cursor = page.cursor;
    if (!cursor) break;
  }

  const profiles = await Promise.all(
    keyNames.map(async (name) => {
      const raw = await env.SUBGLASS_KV.get(name);
      return raw ? normalizeProfile(JSON.parse(raw) as Profile) : null;
    }),
  );
  return profiles.filter((p): p is Profile => p !== null);
}

export function newProfile(name: string): Profile {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name,
    upstreams: [],
    selectedIds: [],
    renameMap: {},
    chains: [],
    targets: [],
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 拉取上游订阅内容，带短 TTL 缓存；缓存命中时不发起真实请求 */
export async function fetchUpstreamCached(env: Env, url: string): Promise<string> {
  assertSafeUpstreamUrl(url);

  // 分享链接本身就是节点内容，不需要通过 fetch 拉取。
  if (!/^https?:/i.test(url)) return url;

  const cacheKey = CACHE_PREFIX + (await sha256Hex(url));
  const cached = await env.SUBGLASS_KV.get(cacheKey);
  if (cached !== null) return cached;

  const resp = await fetch(url, {
    headers: { "User-Agent": "SubGlass/1.0 (+https://github.com/)" },
    cf: { cacheTtl: UPSTREAM_CACHE_TTL_SECONDS, cacheEverything: true },
  });
  if (!resp.ok) {
    throw new Error(`上游订阅拉取失败 (${resp.status}): ${url}`);
  }
  const text = await resp.text();
  await env.SUBGLASS_KV.put(cacheKey, text, { expirationTtl: UPSTREAM_CACHE_TTL_SECONDS });
  return text;
}

export function markTargetGenerated(profile: Profile, target: TargetFormat): void {
  if (!profile.targets.includes(target)) profile.targets.push(target);
  profile.updatedAt = Date.now();
}
