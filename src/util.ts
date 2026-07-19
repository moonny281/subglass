// 通用工具：Workers runtime 和 Node(测试用) 都原生支持 atob/btoa/TextEncoder，
// 因此不依赖 Buffer，保证同一套代码两边可跑。

export function b64UrlToStd(s: string): string {
  return s.replace(/-/g, "+").replace(/_/g, "/");
}

export function stdToB64Url(s: string): string {
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 解码 base64 / base64url（自动补齐 padding）为 UTF-8 字符串 */
export function b64Decode(input: string): string {
  const std = b64UrlToStd(input.trim());
  const padded = std + "=".repeat((4 - (std.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/** 将 UTF-8 字符串编码为标准 base64（不做 url-safe 替换） */
export function b64Encode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** 同步 FNV-1a 32位 hash，用于生成节点稳定 id（无需 await crypto.subtle） */
export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** 由节点关键字段生成稳定 id：同一实际节点（服务器+端口+凭证）多次导入应产生同一 id，便于去重 */
export function nodeIdOf(type: string, server: string, port: number, secret: string): string {
  return `${type}-${fnv1a(`${type}|${server}|${port}|${secret}`)}`;
}

/** 将原始字节(如 HMAC 签名)编码为 base64url，注意与 b64Encode 不同：不做 UTF-8 转码 */
export function bytesToB64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return stdToB64Url(btoa(binary));
}

/** 恒定时间字符串比较，防止会话签名校验被时序攻击 */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 安全解析 URL query 为普通对象 */
export function queryToObject(search: string): Record<string, string> {
  const params = new URLSearchParams(search);
  const obj: Record<string, string> = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return obj;
}
