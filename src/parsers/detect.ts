import type { UNode } from "../model";
import { parseClashYaml } from "./clash";
import { parseSingbox } from "./singbox";
import { tryParseUri } from "./uri";
import { b64Decode } from "../util";

export type DetectedFormat = "clash" | "singbox" | "uri-list";

/** 把一段文本按行拆分成分享链接节点，跳过无法识别的脏行 */
function parseUriList(text: string): UNode[] {
  const nodes: UNode[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const n = tryParseUri(line);
    if (n) nodes.push(n);
  }
  return nodes;
}

/** 猜测原始内容格式（不做解析，仅用于展示/日志） */
export function detectFormat(text: string): DetectedFormat {
  const trimmed = text.trim();
  if (looksLikeSingbox(trimmed)) return "singbox";
  if (looksLikeClash(trimmed)) return "clash";
  return "uri-list";
}

function looksLikeSingbox(text: string): boolean {
  if (!text.startsWith("{") && !text.startsWith("[")) return false;
  try {
    const doc = JSON.parse(text);
    if (Array.isArray(doc)) return doc.some((o) => o && typeof o === "object" && "type" in o && "server" in o);
    return Array.isArray(doc?.outbounds);
  } catch {
    return false;
  }
}

function looksLikeClash(text: string): boolean {
  // 粗略特征：包含 "proxies:" 顶层键，或本身就是一段以 "- name:" 起始的yaml列表
  return /^proxies:\s*$/m.test(text) || /^\s*-\s*\{?\s*name:/m.test(text);
}

/**
 * 解析任意上游订阅内容为 UNode[]。
 * 依次尝试: sing-box json -> clash yaml -> 分享链接列表(含整体base64订阅)
 */
export function parseSubscription(text: string): UNode[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (looksLikeSingbox(trimmed)) {
    try {
      const nodes = parseSingbox(trimmed);
      if (nodes.length) return nodes;
    } catch {
      /* 继续尝试下一种格式 */
    }
  }

  if (looksLikeClash(trimmed)) {
    try {
      const nodes = parseClashYaml(trimmed);
      if (nodes.length) return nodes;
    } catch {
      /* 继续尝试下一种格式 */
    }
  }

  // 直接按行是分享链接列表？
  const direct = parseUriList(trimmed);
  if (direct.length) return direct;

  // 否则整段可能是 base64 编码后的订阅内容（v2rayN 标准格式）
  try {
    const decoded = b64Decode(trimmed.replace(/\s+/g, ""));
    return parseUriList(decoded);
  } catch {
    return [];
  }
}

/** 对同一批节点按 id 去重，后出现的覆盖先出现的（用于合并多个上游） */
export function dedupeNodes(nodes: UNode[]): UNode[] {
  const map = new Map<string, UNode>();
  for (const n of nodes) map.set(n.id, n);
  return [...map.values()];
}
