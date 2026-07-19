import yaml from "js-yaml";
import type { UNode, TransportType } from "../model";
import { nodeIdOf } from "../util";

// Clash/mihomo proxies 字段参考: https://wiki.metacubex.one/config/proxies/
// 本文件只处理我们支持的5种类型: vmess/vless/trojan/ss/hysteria2

interface ClashProxy {
  name: string;
  type: string;
  server: string;
  port: number;
  uuid?: string;
  password?: string;
  cipher?: string; // ss
  alterId?: number; // vmess
  udp?: boolean;
  tls?: boolean;
  sni?: string;
  servername?: string;
  "skip-cert-verify"?: boolean;
  "client-fingerprint"?: string;
  alpn?: string[];
  flow?: string;
  network?: string; // ws/grpc/h2/tcp
  "ws-opts"?: { path?: string; headers?: Record<string, string> };
  "grpc-opts"?: { "grpc-service-name"?: string };
  "reality-opts"?: { "public-key"?: string; "short-id"?: string };
  obfs?: string; // hysteria2: salamander
  "obfs-password"?: string;
  "up"?: number;
  "down"?: number;
}

interface ClashConfig {
  proxies?: ClashProxy[];
}

function toUNode(p: ClashProxy): UNode | null {
  const sni = p.sni || p.servername;
  const tls: UNode["tls"] | undefined =
    p.tls || p.type === "trojan" || p.type === "hysteria2"
      ? {
          enabled: true,
          sni,
          fingerprint: p["client-fingerprint"],
          alpn: p.alpn,
          allowInsecure: p["skip-cert-verify"],
          reality: p["reality-opts"]?.["public-key"]
            ? { publicKey: p["reality-opts"]["public-key"]!, shortId: p["reality-opts"]["short-id"] }
            : undefined,
        }
      : { enabled: false };

  const transport: UNode["transport"] | undefined = p.network
    ? {
        type: p.network as TransportType,
        path: p["ws-opts"]?.path,
        host: p["ws-opts"]?.headers?.Host || p["ws-opts"]?.headers?.host,
        serviceName: p["grpc-opts"]?.["grpc-service-name"],
      }
    : undefined;

  switch (p.type) {
    case "vmess":
      return {
        id: nodeIdOf("vmess", p.server, p.port, p.uuid || ""),
        type: "vmess",
        name: p.name,
        server: p.server,
        port: p.port,
        uuid: p.uuid,
        alterId: p.alterId ?? 0,
        transport: transport || { type: "tcp" },
        tls,
        extra: p.cipher ? { scy: p.cipher } : undefined,
      };
    case "vless":
      return {
        id: nodeIdOf("vless", p.server, p.port, p.uuid || ""),
        type: "vless",
        name: p.name,
        server: p.server,
        port: p.port,
        uuid: p.uuid,
        flow: p.flow,
        transport: transport || { type: "tcp" },
        tls,
      };
    case "trojan":
      return {
        id: nodeIdOf("trojan", p.server, p.port, p.password || ""),
        type: "trojan",
        name: p.name,
        server: p.server,
        port: p.port,
        password: p.password,
        transport: transport || { type: "tcp" },
        tls,
      };
    case "ss":
      return {
        id: nodeIdOf("ss", p.server, p.port, `${p.cipher}:${p.password}`),
        type: "ss",
        name: p.name,
        server: p.server,
        port: p.port,
        method: p.cipher,
        password: p.password,
      };
    case "hysteria2":
      return {
        id: nodeIdOf("hysteria2", p.server, p.port, p.password || ""),
        type: "hysteria2",
        name: p.name,
        server: p.server,
        port: p.port,
        password: p.password,
        tls: { ...tls, enabled: true },
        obfs: p.obfs === "salamander" ? { type: "salamander", password: p["obfs-password"] || "" } : undefined,
        upMbps: p.up,
        downMbps: p.down,
      };
    default:
      return null; // 不支持的类型直接跳过，不中断整体导入
  }
}

/** 解析 clash/mihomo 完整配置或仅 proxies 片段的 yaml 文本 */
export function parseClashYaml(text: string): UNode[] {
  const doc = yaml.load(text) as ClashConfig | ClashProxy[] | null;
  const proxies: ClashProxy[] = Array.isArray(doc) ? doc : doc?.proxies || [];
  const nodes: UNode[] = [];
  for (const p of proxies) {
    const n = toUNode(p);
    if (n) nodes.push(n);
  }
  return nodes;
}

function fromUNode(n: UNode): ClashProxy {
  const base: ClashProxy = {
    name: n.name,
    type: n.type === "ss" ? "ss" : n.type,
    server: n.server,
    port: n.port,
    udp: true,
  };

  if (n.tls?.enabled) {
    base.tls = true;
    if (n.tls.sni) base.sni = n.tls.sni;
    if (n.tls.fingerprint) base["client-fingerprint"] = n.tls.fingerprint;
    if (n.tls.alpn?.length) base.alpn = n.tls.alpn;
    if (n.tls.allowInsecure) base["skip-cert-verify"] = true;
    if (n.tls.reality?.publicKey) {
      base["reality-opts"] = {
        "public-key": n.tls.reality.publicKey,
        "short-id": n.tls.reality.shortId,
      };
    }
  }

  if (n.transport && n.transport.type !== "tcp") {
    base.network = n.transport.type;
    if (n.transport.type === "ws") {
      base["ws-opts"] = {
        path: n.transport.path || "/",
        headers: n.transport.host ? { Host: n.transport.host } : undefined,
      };
    } else if (n.transport.type === "grpc") {
      base["grpc-opts"] = { "grpc-service-name": n.transport.serviceName || "" };
    }
  }

  switch (n.type) {
    case "vmess":
      base.uuid = n.uuid;
      base.alterId = n.alterId ?? 0;
      base.cipher = n.extra?.scy || "auto";
      break;
    case "vless":
      base.uuid = n.uuid;
      if (n.flow) base.flow = n.flow;
      break;
    case "trojan":
      base.password = n.password;
      break;
    case "ss":
      base.cipher = n.method;
      base.password = n.password;
      break;
    case "hysteria2":
      base.password = n.password;
      base.tls = true;
      if (n.obfs) {
        base.obfs = n.obfs.type;
        base["obfs-password"] = n.obfs.password;
      }
      if (n.upMbps) base.up = n.upMbps;
      if (n.downMbps) base.down = n.downMbps;
      break;
  }
  return base;
}

/** 渲染为完整可直接使用的 clash/mihomo 配置(proxies + 一个全选代理组 + 基础规则) */
export function encodeClashYaml(nodes: UNode[]): string {
  const proxies = nodes.map(fromUNode);
  const names = proxies.map((p) => p.name);
  const config = {
    "mixed-port": 7890,
    "allow-lan": false,
    mode: "rule",
    "log-level": "info",
    "unified-delay": true,
    "tcp-concurrent": true,
    proxies,
    "proxy-groups": [
      {
        name: "🚀 节点选择",
        type: "select",
        proxies: ["♻️ 自动选择", ...names, "DIRECT"],
      },
      {
        name: "♻️ 自动选择",
        type: "url-test",
        proxies: names,
        url: "https://www.gstatic.com/generate_204",
        interval: 300,
      },
    ],
    rules: ["MATCH,🚀 节点选择"],
  };
  return yaml.dump(config, { lineWidth: -1 });
}
