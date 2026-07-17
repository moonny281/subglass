import { bytesToB64Url, timingSafeEqual } from "./util";

const COOKIE_NAME = "subglass_session";
const SESSION_TTL_SECONDS = 24 * 60 * 60; // 24小时，过期需要重新用ADMIN_TOKEN登录

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return bytesToB64Url(new Uint8Array(sig));
}

/** 用 ADMIN_TOKEN 作为密钥签发一个短期会话 token，格式: {过期时间戳}.{HMAC签名} */
export async function createSessionToken(adminToken: string): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = String(expiresAt);
  const sig = await hmacSign(adminToken, payload);
  return { token: `${payload}.${sig}`, expiresAt };
}

/** 校验会话 token 的签名与是否过期 */
export async function verifySessionToken(sessionToken: string, adminToken: string): Promise<boolean> {
  const parts = sessionToken.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;

  const expiresAt = Number(payload);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;

  const expectedSig = await hmacSign(adminToken, payload);
  return timingSafeEqual(sig, expectedSig);
}

function getCookie(req: Request, name: string): string | null {
  const header = req.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return null;
}

export function getSessionTokenFromRequest(req: Request): string | null {
  return getCookie(req, COOKIE_NAME);
}

/** 构造下发会话 Cookie 的 Set-Cookie 值。Secure 标记根据请求协议自动判断，方便本地 http 开发 */
export function buildSetCookieHeader(req: Request, value: string, maxAgeSeconds: number): string {
  const isHttps = new URL(req.url).protocol === "https:";
  const parts = [`${COOKIE_NAME}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Strict", `Max-Age=${maxAgeSeconds}`];
  if (isHttps) parts.push("Secure");
  return parts.join("; ");
}

export function buildClearCookieHeader(req: Request): string {
  return buildSetCookieHeader(req, "", 0);
}

export { SESSION_TTL_SECONDS };
