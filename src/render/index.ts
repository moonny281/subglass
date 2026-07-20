import type { UNode, TargetFormat } from "../model";
import { encodeClashYaml } from "../parsers/clash";
import { encodeSingbox } from "../parsers/singbox";
import { encodeV2rayList } from "./toV2ray";

export interface RenderResult {
  body: string;
  contentType: string;
  extraHeaders: Record<string, string>;
  fileExt: string;
}

/**
 * 生成各客户端订阅所需的响应头。
 * Subscription-Userinfo 几乎所有客户端都会读来显示流量/到期信息。我们没有真实流量统计
 * （本工具只生成配置文件，看不到节点实际代理流量），给一个"无限流量"的假值避免客户端因缺
 * 字段报错或显示异常；expire 字段则是真实的——取自方案设置的到期时间，未设置则永不过期。
 */
function subscriptionUserinfo(expiresAtMs?: number | null): string {
  const fakeTotalBytes = 1024 * 1024 * 1024 * 1024; // 1TB 占位，流量数字本身不代表真实用量
  const expire = expiresAtMs ? Math.floor(expiresAtMs / 1000) : 0;
  return `upload=0; download=0; total=${fakeTotalBytes}; expire=${expire}`;
}

export function renderSubscription(
  nodes: UNode[],
  target: TargetFormat,
  profileName: string,
  expiresAtMs?: number | null,
): RenderResult {
  const common = {
    "Profile-Update-Interval": "24",
    "Subscription-Userinfo": subscriptionUserinfo(expiresAtMs),
  };

  switch (target) {
    case "clash":
      return {
        body: encodeClashYaml(nodes),
        contentType: "text/yaml; charset=utf-8",
        extraHeaders: {
          ...common,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(profileName)}.yaml`,
        },
        fileExt: "yaml",
      };
    case "singbox":
      return {
        body: encodeSingbox(nodes),
        contentType: "application/json; charset=utf-8",
        extraHeaders: {
          "Profile-Update-Interval": common["Profile-Update-Interval"],
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(profileName)}.json`,
        },
        fileExt: "json",
      };
    case "v2ray":
      return {
        body: encodeV2rayList(nodes),
        contentType: "text/plain; charset=utf-8",
        extraHeaders: {
          ...common,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(profileName)}.txt`,
        },
        fileExt: "txt",
      };
    default:
      throw new Error(`未知目标格式: ${target as string}`);
  }
}
