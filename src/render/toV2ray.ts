import type { UNode } from "../model";
import { encodeUri } from "../parsers/uri";
import { b64Encode } from "../util";

/**
 * 渲染为通用订阅格式：每行一个分享链接(vmess/vless/trojan/ss/hysteria2 uri)，
 * 整体 base64 编码。兼容 v2rayN / v2rayNG / Shadowrocket / NekoBox / Streisand 等。
 */
export function encodeV2rayList(nodes: UNode[]): string {
  const lines = nodes.map((n) => {
    try {
      return encodeUri(n);
    } catch {
      return null;
    }
  });
  const text = lines.filter((l): l is string => l !== null).join("\n");
  return b64Encode(text);
}
