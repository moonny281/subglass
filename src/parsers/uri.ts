import type { UNode, TransportType } from "../model";
import { b64Decode, b64Encode, stdToB64Url, nodeIdOf, queryToObject } from "../util";

// ---------------------------------------------------------------------------
// 公共小工具
// ---------------------------------------------------------------------------

/** #fragment 是节点名，需要 decodeURIComponent；缺失时给一个占位名 */
function extractName(hash: string, fallback: string): string {
  const raw = hash.replace(/^#/, "");
  if (!raw) return fallback;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function splitHostPort(hostPort: string): { host: string; port: number } {
  // 兼容 IPv6 字面量 [::1]:443
  const m = hostPort.match(/^\[([^\]]+)\]:(\d+)$/);
  if (m) return { host: m[1], port: Number(m[2]) };
  const idx = hostPort.lastIndexOf(":");
  if (idx === -1) throw new Error(`缺少端口: ${hostPort}`);
  return { host: hostPort.slice(0, idx), port: Number(hostPort.slice(idx + 1)) };
}

function hostForUri(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function transportFromQuery(q: Record<string, string>): UNode["transport"] {
  const type = (q.type || "tcp") as TransportType;
  return {
    type,
    path: q.path ? safeDecodeURIComponent(q.path) : undefined,
    host: q.host || undefined,
    serviceName: q.serviceName || q.servicename || undefined,
  };
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// ---------------------------------------------------------------------------
// VMess: vmess://BASE64(JSON)
// ---------------------------------------------------------------------------

interface VmessJson {
  v?: string | number;
  ps?: string;
  add: string;
  port: string | number;
  id: string;
  aid?: string | number;
  scy?: string;
  net?: string;
  type?: string;
  host?: string;
  path?: string;
  tls?: string;
  sni?: string;
  alpn?: string;
  fp?: string;
}

function parseVmess(uri: string): UNode {
  const b64 = uri.replace(/^vmess:\/\//, "");
  const json = JSON.parse(b64Decode(b64)) as VmessJson;
  const port = Number(json.port);
  const tlsEnabled = json.tls === "tls" || json.tls === "reality";
  const node: UNode = {
    id: nodeIdOf("vmess", json.add, port, json.id),
    type: "vmess",
    name: json.ps || `${json.add}:${port}`,
    server: json.add,
    port,
    uuid: json.id,
    alterId: json.aid !== undefined ? Number(json.aid) : 0,
    transport: {
      type: (json.net as TransportType) || "tcp",
      path: json.path,
      host: json.host,
    },
    tls: tlsEnabled
      ? {
          enabled: true,
          sni: json.sni || json.host,
          alpn: json.alpn ? json.alpn.split(",").map((s) => s.trim()) : undefined,
          fingerprint: json.fp,
        }
      : { enabled: false },
    extra: json.scy ? { scy: json.scy } : undefined,
  };
  return node;
}

function encodeVmess(node: UNode): string {
  const json: VmessJson = {
    v: "2",
    ps: node.name,
    add: node.server,
    port: node.port,
    id: node.uuid || "",
    aid: node.alterId ?? 0,
    scy: node.extra?.scy || "auto",
    net: node.transport?.type || "tcp",
    type: "none",
    host: node.transport?.host || "",
    path: node.transport?.path || "",
    tls: node.tls?.enabled ? "tls" : "",
    sni: node.tls?.sni || "",
    alpn: node.tls?.alpn?.join(",") || "",
    fp: node.tls?.fingerprint || "",
  };
  return `vmess://${b64Encode(JSON.stringify(json))}`;
}

// ---------------------------------------------------------------------------
// VLESS: vless://uuid@host:port?params#name
// ---------------------------------------------------------------------------

function parseVless(uri: string): UNode {
  const u = new URL(uri);
  const uuid = decodeURIComponent(u.username);
  const { host, port } = splitHostPort(u.host);
  const q = queryToObject(u.search);
  const security = q.security || "none";
  const tlsEnabled = security === "tls" || security === "reality";

  const node: UNode = {
    id: nodeIdOf("vless", host, port, uuid),
    type: "vless",
    name: extractName(u.hash, `${host}:${port}`),
    server: host,
    port,
    uuid,
    flow: q.flow || undefined,
    transport: transportFromQuery(q),
    tls: tlsEnabled
      ? {
          enabled: true,
          sni: q.sni,
          fingerprint: q.fp,
          alpn: q.alpn ? q.alpn.split(",").map((s) => s.trim()) : undefined,
          allowInsecure: q.allowInsecure === "1" || q.insecure === "1",
          reality:
            security === "reality"
              ? { publicKey: q.pbk || "", shortId: q.sid, spiderX: q.spx }
              : undefined,
        }
      : { enabled: false },
  };
  return node;
}

function encodeVless(node: UNode): string {
  const params = new URLSearchParams();
  params.set("encryption", "none");
  if (node.tls?.enabled) {
    params.set("security", node.tls.reality ? "reality" : "tls");
    if (node.tls.sni) params.set("sni", node.tls.sni);
    if (node.tls.fingerprint) params.set("fp", node.tls.fingerprint);
    if (node.tls.alpn?.length) params.set("alpn", node.tls.alpn.join(","));
    if (node.tls.reality?.publicKey) params.set("pbk", node.tls.reality.publicKey);
    if (node.tls.reality?.shortId) params.set("sid", node.tls.reality.shortId);
    if (node.tls.reality?.spiderX) params.set("spx", node.tls.reality.spiderX);
  } else {
    params.set("security", "none");
  }
  const t = node.transport;
  if (t) {
    params.set("type", t.type);
    if (t.path) params.set("path", t.path);
    if (t.host) params.set("host", t.host);
    if (t.serviceName) params.set("serviceName", t.serviceName);
  }
  if (node.flow) params.set("flow", node.flow);

  const authority = `${encodeURIComponent(node.uuid || "")}@${hostForUri(node.server)}:${node.port}`;
  return `vless://${authority}?${params.toString()}#${encodeURIComponent(node.name)}`;
}

// ---------------------------------------------------------------------------
// Trojan: trojan://password@host:port?params#name
// ---------------------------------------------------------------------------

function parseTrojan(uri: string): UNode {
  const u = new URL(uri);
  const password = decodeURIComponent(u.username);
  const { host, port } = splitHostPort(u.host);
  const q = queryToObject(u.search);
  // trojan 默认走 TLS，除非显式 security=none（少数客户端支持明文，罕见）
  const tlsEnabled = q.security !== "none";

  return {
    id: nodeIdOf("trojan", host, port, password),
    type: "trojan",
    name: extractName(u.hash, `${host}:${port}`),
    server: host,
    port,
    password,
    transport: transportFromQuery(q),
    tls: {
      enabled: tlsEnabled,
      sni: q.sni,
      fingerprint: q.fp,
      alpn: q.alpn ? q.alpn.split(",").map((s) => s.trim()) : undefined,
      allowInsecure: q.allowInsecure === "1",
    },
  };
}

function encodeTrojan(node: UNode): string {
  const params = new URLSearchParams();
  params.set("security", node.tls?.enabled === false ? "none" : "tls");
  if (node.tls?.sni) params.set("sni", node.tls.sni);
  if (node.tls?.fingerprint) params.set("fp", node.tls.fingerprint);
  if (node.tls?.alpn?.length) params.set("alpn", node.tls.alpn.join(","));
  if (node.tls?.allowInsecure) params.set("allowInsecure", "1");
  const t = node.transport;
  if (t && t.type !== "tcp") {
    params.set("type", t.type);
    if (t.path) params.set("path", t.path);
    if (t.host) params.set("host", t.host);
  }
  const authority = `${encodeURIComponent(node.password || "")}@${hostForUri(node.server)}:${node.port}`;
  return `trojan://${authority}?${params.toString()}#${encodeURIComponent(node.name)}`;
}

// ---------------------------------------------------------------------------
// Shadowsocks: 支持 SIP002 (ss://base64(method:pass)@host:port#name)
// 和明文 (ss://method:pass@host:port#name) 两种，以及极少见的全串 base64 老格式
// ---------------------------------------------------------------------------

function parseSs(uri: string): UNode {
  const body = uri.replace(/^ss:\/\//, "");
  const hashIdx = body.indexOf("#");
  const name = hashIdx >= 0 ? extractName(body.slice(hashIdx), "") : "";
  const withoutName = hashIdx >= 0 ? body.slice(0, hashIdx) : body;

  const atIdx = withoutName.lastIndexOf("@");
  let method: string, password: string, hostPort: string;

  if (atIdx >= 0) {
    // SIP002: userinfo 可能是 base64 或明文 method:password
    const userinfo = withoutName.slice(0, atIdx);
    hostPort = withoutName.slice(atIdx + 1).split("?")[0];
    let decoded = userinfo;
    if (!userinfo.includes(":")) {
      decoded = b64Decode(userinfo);
    }
    const sep = decoded.indexOf(":");
    method = decoded.slice(0, sep);
    password = decoded.slice(sep + 1);
  } else {
    // 老格式：整体 base64(method:password@host:port)
    const decoded = b64Decode(withoutName);
    const at = decoded.lastIndexOf("@");
    const cred = decoded.slice(0, at);
    hostPort = decoded.slice(at + 1);
    const sep = cred.indexOf(":");
    method = cred.slice(0, sep);
    password = cred.slice(sep + 1);
  }

  const { host, port } = splitHostPort(hostPort);

  return {
    id: nodeIdOf("ss", host, port, `${method}:${password}`),
    type: "ss",
    name: name || `${host}:${port}`,
    server: host,
    port,
    method,
    password,
  };
}

function encodeSs(node: UNode): string {
  const userinfo = stdToB64Url(
    // 用标准 base64 生成后转 url-safe，兼容更多客户端解析实现
    btoa(`${node.method}:${node.password}`),
  );
  return `ss://${userinfo}@${hostForUri(node.server)}:${node.port}#${encodeURIComponent(node.name)}`;
}

// ---------------------------------------------------------------------------
// Hysteria2: hysteria2://password@host:port?params#name  (hy2:// 为别名)
// ---------------------------------------------------------------------------

function parseHysteria2(uri: string): UNode {
  const normalized = uri.replace(/^hy2:\/\//, "hysteria2://");
  const u = new URL(normalized);
  const password = decodeURIComponent(u.username);
  const { host, port } = splitHostPort(u.host);
  const q = queryToObject(u.search);

  const node: UNode = {
    id: nodeIdOf("hysteria2", host, port, password),
    type: "hysteria2",
    name: extractName(u.hash, `${host}:${port}`),
    server: host,
    port,
    password,
    tls: {
      enabled: true,
      sni: q.sni,
      allowInsecure: q.insecure === "1",
      alpn: q.alpn ? q.alpn.split(",").map((s) => s.trim()) : undefined,
    },
  };
  if (q.obfs === "salamander") {
    node.obfs = { type: "salamander", password: q["obfs-password"] || "" };
  }
  return node;
}

function encodeHysteria2(node: UNode): string {
  const params = new URLSearchParams();
  if (node.tls?.sni) params.set("sni", node.tls.sni);
  if (node.tls?.allowInsecure) params.set("insecure", "1");
  if (node.tls?.alpn?.length) params.set("alpn", node.tls.alpn.join(","));
  if (node.obfs) {
    params.set("obfs", node.obfs.type);
    params.set("obfs-password", node.obfs.password);
  }
  const authority = `${encodeURIComponent(node.password || "")}@${hostForUri(node.server)}:${node.port}`;
  return `hysteria2://${authority}?${params.toString()}#${encodeURIComponent(node.name)}`;
}

// ---------------------------------------------------------------------------
// Hysteria (v1): hysteria://host:port?auth=xxx&peer=sni&insecure=1&upmbps=&downmbps=&obfs=&obfsParam=&alpn=&protocol=#name
// ---------------------------------------------------------------------------

function parseHysteria(uri: string): UNode {
  const u = new URL(uri);
  const { host, port } = splitHostPort(u.host);
  const q = queryToObject(u.search);
  const authStr = q.auth || q["auth-str"] || "";

  const node: UNode = {
    id: nodeIdOf("hysteria", host, port, authStr),
    type: "hysteria",
    name: extractName(u.hash, `${host}:${port}`),
    server: host,
    port,
    password: authStr,
    protocol: q.protocol || "udp",
    upMbps: q.upmbps ? Number(q.upmbps) : undefined,
    downMbps: q.downmbps ? Number(q.downmbps) : undefined,
    tls: {
      enabled: true,
      sni: q.peer || q.sni,
      allowInsecure: q.insecure === "1",
      alpn: q.alpn ? q.alpn.split(",").map((s) => s.trim()) : undefined,
    },
  };
  if (q.obfs) node.obfs = { type: q.obfs, password: q.obfsParam || q["obfs-password"] || "" };
  return node;
}

function encodeHysteria(node: UNode): string {
  const params = new URLSearchParams();
  params.set("auth", node.password || "");
  if (node.protocol && node.protocol !== "udp") params.set("protocol", node.protocol);
  if (node.tls?.sni) params.set("peer", node.tls.sni);
  if (node.tls?.allowInsecure) params.set("insecure", "1");
  if (node.tls?.alpn?.length) params.set("alpn", node.tls.alpn.join(","));
  if (node.upMbps !== undefined) params.set("upmbps", String(node.upMbps));
  if (node.downMbps !== undefined) params.set("downmbps", String(node.downMbps));
  if (node.obfs) {
    params.set("obfs", node.obfs.type);
    params.set("obfsParam", node.obfs.password);
  }
  return `hysteria://${hostForUri(node.server)}:${node.port}?${params.toString()}#${encodeURIComponent(node.name)}`;
}

// ---------------------------------------------------------------------------
// TUIC (v5): tuic://uuid:password@host:port?congestion_control=&udp_relay_mode=&sni=&alpn=&allow_insecure=#name
// ---------------------------------------------------------------------------

function parseTuic(uri: string): UNode {
  const u = new URL(uri);
  const [uuid, password] = decodeURIComponent(u.username + (u.password ? ":" + u.password : "")).split(/:(.*)/s);
  const { host, port } = splitHostPort(u.host);
  const q = queryToObject(u.search);

  return {
    id: nodeIdOf("tuic", host, port, `${uuid}:${password || ""}`),
    type: "tuic",
    name: extractName(u.hash, `${host}:${port}`),
    server: host,
    port,
    uuid,
    password: password || "",
    congestionControl: q.congestion_control || q.cc || undefined,
    udpRelayMode: (q.udp_relay_mode as UNode["udpRelayMode"]) || undefined,
    tls: {
      enabled: true,
      sni: q.sni,
      allowInsecure: q.allow_insecure === "1" || q.insecure === "1",
      alpn: q.alpn ? q.alpn.split(",").map((s) => s.trim()) : undefined,
    },
  };
}

function encodeTuic(node: UNode): string {
  const params = new URLSearchParams();
  if (node.congestionControl) params.set("congestion_control", node.congestionControl);
  if (node.udpRelayMode) params.set("udp_relay_mode", node.udpRelayMode);
  if (node.tls?.sni) params.set("sni", node.tls.sni);
  if (node.tls?.allowInsecure) params.set("allow_insecure", "1");
  if (node.tls?.alpn?.length) params.set("alpn", node.tls.alpn.join(","));
  const authority = `${encodeURIComponent(node.uuid || "")}:${encodeURIComponent(node.password || "")}@${hostForUri(node.server)}:${node.port}`;
  return `tuic://${authority}?${params.toString()}#${encodeURIComponent(node.name)}`;
}

// ---------------------------------------------------------------------------
// 统一入口
// ---------------------------------------------------------------------------

export function parseUri(uri: string): UNode {
  const trimmed = uri.trim();
  if (trimmed.startsWith("vmess://")) return parseVmess(trimmed);
  if (trimmed.startsWith("vless://")) return parseVless(trimmed);
  if (trimmed.startsWith("trojan://")) return parseTrojan(trimmed);
  if (trimmed.startsWith("ss://")) return parseSs(trimmed);
  if (trimmed.startsWith("hysteria2://") || trimmed.startsWith("hy2://")) return parseHysteria2(trimmed);
  if (trimmed.startsWith("hysteria://")) return parseHysteria(trimmed);
  if (trimmed.startsWith("tuic://")) return parseTuic(trimmed);
  throw new Error(`不支持的分享链接协议: ${trimmed.slice(0, 16)}...`);
}

export function encodeUri(node: UNode): string {
  switch (node.type) {
    case "vmess":
      return encodeVmess(node);
    case "vless":
      return encodeVless(node);
    case "trojan":
      return encodeTrojan(node);
    case "ss":
      return encodeSs(node);
    case "hysteria2":
      return encodeHysteria2(node);
    case "hysteria":
      return encodeHysteria(node);
    case "tuic":
      return encodeTuic(node);
    default:
      throw new Error(`未知节点类型: ${(node as UNode).type}`);
  }
}

/** 尝试解析任意一行文本为节点，失败返回 null（用于批量导入时跳过脏行） */
export function tryParseUri(uri: string): UNode | null {
  try {
    return parseUri(uri);
  } catch {
    return null;
  }
}
