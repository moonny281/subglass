// 基础的 SSRF 防御：只做协议白名单 + 常见内网/本地主机名字符串匹配。
// 注意：这不是完整的防护（不能防 DNS rebinding 之类的攻击），
// Cloudflare Workers 边缘本身会拦截对裸 IP 的直连请求，这里是额外一层针对域名场景的防御。

const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // 链路本地地址，含常见云元数据服务地址段
  /^::1$/,
  /^fc[0-9a-f]{2}:/i, // IPv6 唯一本地地址 fc00::/7
  /^fe80:/i, // IPv6 链路本地
];

export class UnsafeUrlError extends Error {}

/** 校验上游订阅链接是否安全可拉取，不安全则抛出 UnsafeUrlError */
export function assertSafeUpstreamUrl(urlStr: string): void {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new UnsafeUrlError("不是合法的URL");
  }
  const shareProtocols = new Set(["vmess:", "vless:", "trojan:", "ss:", "hysteria2:", "hy2:"]);
  if (shareProtocols.has(url.protocol)) return;
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("仅支持 http/https 协议的订阅链接");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOSTNAME_PATTERNS.some((p) => p.test(hostname))) {
    throw new UnsafeUrlError("不允许拉取内网/本地地址");
  }
}
