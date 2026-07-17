import type { Env } from "./env";
import type { Profile, TargetFormat } from "./model";

const PROFILE_PREFIX = "profile:";
const CACHE_PREFIX = "cache:";
const UPSTREAM_CACHE_TTL_SECONDS = 600; // 10分钟，防止上游被高频拉取的客户端打爆

export async function getProfile(env: Env, id: string): Promise<Profile | null> {
  const raw = await env.SUBGLASS_KV.get(PROFILE_PREFIX + id);
  return raw ? (JSON.parse(raw) as Profile) : null;
}

export async function putProfile(env: Env, profile: Profile): Promise<void> {
  await env.SUBGLASS_KV.put(PROFILE_PREFIX + profile.id, JSON.stringify(profile));
}

export async function deleteProfile(env: Env, id: string): Promise<void> {
  await env.SUBGLASS_KV.delete(PROFILE_PREFIX + id);
}

/** 列出所有 profile（后台展示页用，个人项目量级下直接 list 即可，无需分页） */
export async function listProfiles(env: Env): Promise<Profile[]> {
  const { keys } = await env.SUBGLASS_KV.list({ prefix: PROFILE_PREFIX });
  const profiles = await Promise.all(
    keys.map(async (k) => {
      const raw = await env.SUBGLASS_KV.get(k.name);
      return raw ? (JSON.parse(raw) as Profile) : null;
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
    targets: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 拉取上游订阅内容，带短 TTL 缓存；缓存命中时不发起真实请求 */
export async function fetchUpstreamCached(env: Env, url: string): Promise<string> {
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
