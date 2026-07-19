import type { Env } from "./env";

interface LoginBucket {
  attempts: number;
  lockedUntil: number; // 0 表示当前未锁定
}

const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000; // 连续失败5次后锁定15分钟
const BUCKET_TTL_SECONDS = 20 * 60; // KV条目自动过期，避免堆积

function bucketKey(ip: string): string {
  return `ratelimit:login:${ip}`;
}

async function getBucket(env: Env, ip: string): Promise<LoginBucket> {
  const raw = await env.SUBGLASS_KV.get(bucketKey(ip));
  return raw ? (JSON.parse(raw) as LoginBucket) : { attempts: 0, lockedUntil: 0 };
}

/** 登录前调用：检查该来源IP当前是否处于锁定期 */
export async function checkLoginRateLimit(env: Env, ip: string): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const bucket = await getBucket(env, ip);
  const now = Date.now();
  if (bucket.lockedUntil > now) {
    return { allowed: false, retryAfterSeconds: Math.ceil((bucket.lockedUntil - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** 登录后调用：成功则清空计数，失败则累加，达到阈值后锁定 */
export async function recordLoginAttempt(env: Env, ip: string, success: boolean): Promise<void> {
  if (success) {
    await env.SUBGLASS_KV.delete(bucketKey(ip));
    return;
  }
  const bucket = await getBucket(env, ip);
  bucket.attempts += 1;
  if (bucket.attempts >= MAX_ATTEMPTS) {
    bucket.lockedUntil = Date.now() + LOCK_MS;
    bucket.attempts = 0;
  }
  await env.SUBGLASS_KV.put(bucketKey(ip), JSON.stringify(bucket), { expirationTtl: BUCKET_TTL_SECONDS });
}
