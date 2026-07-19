import type { UNode, TransportType } from "../model";
import { nodeIdOf } from "../util";

// sing-box outbound 字段参考: https://sing-box.sagernet.org/configuration/outbound/
// 支持: vless / vmess / trojan / shadowsocks / hysteria2

interface SbTls {
  enabled?: boolean;
  server_name?: string;
  insecure?: boolean;
  alpn?: string[];
  utls?: { enabled?: boolean; fingerprint?: string };
  reality?: { enabled?: boolean; public_key?: string; short_id?: string };
}

interface SbTransport {
  type?: string;
  path?: string;
  headers?: Record<string, string>;
  service_name?: string;
}

interface SbOutbound {
  type: string;
  tag: string;
  server: string;
  server_port: number;
  uuid?: string;
  password?: string;
  method?: string; // shadowsocks
  alter_id?: number; // vmess
  security?: string; // vmess cipher
  flow?: string; // vless
  tls?: SbTls;
  transport?: SbTransport;
  obfs?: { type: string; password: string }; // hysteria(v1)/hysteria2
  up_mbps?: number;
  down_mbps?: number;
  // hysteria(v1): sing-box 的 hysteria 出站固定走 QUIC/UDP，没有 clash 那种 protocol 变体字段
  auth_str?: string;
  // tuic
  congestion_control?: string;
  udp_relay_mode?: string;
}

interface SbConfig {
  outbounds?: SbOutbound[];
}

function tlsFrom(sb?: SbTls): UNode["tls"] {
  if (!sb || !sb.enabled) return { enabled: false };
  return {
    enabled: true,
    sni: sb.server_name,
    fingerprint: sb.utls?.enabled ? sb.utls.fingerprint : undefined,
    alpn: sb.alpn,
    allowInsecure: sb.insecure,
    reality: sb.reality?.enabled
      ? { publicKey: sb.reality.public_key || "", shortId: sb.reality.short_id }
      : undefined,
  };
}

function transportFrom(t?: SbTransport): UNode["transport"] {
  if (!t || !t.type) return { type: "tcp" };
  return {
    type: t.type as TransportType,
    path: t.path,
    host: t.headers?.Host || t.headers?.host,
    serviceName: t.service_name,
  };
}

function toUNode(o: SbOutbound): UNode | null {
  switch (o.type) {
    case "vmess":
      return {
        id: nodeIdOf("vmess", o.server, o.server_port, o.uuid || ""),
        type: "vmess",
        name: o.tag,
        server: o.server,
        port: o.server_port,
        uuid: o.uuid,
        alterId: o.alter_id ?? 0,
        transport: transportFrom(o.transport),
        tls: tlsFrom(o.tls),
        extra: o.security ? { scy: o.security } : undefined,
      };
    case "vless":
      return {
        id: nodeIdOf("vless", o.server, o.server_port, o.uuid || ""),
        type: "vless",
        name: o.tag,
        server: o.server,
        port: o.server_port,
        uuid: o.uuid,
        flow: o.flow,
        transport: transportFrom(o.transport),
        tls: tlsFrom(o.tls),
      };
    case "trojan":
      return {
        id: nodeIdOf("trojan", o.server, o.server_port, o.password || ""),
        type: "trojan",
        name: o.tag,
        server: o.server,
        port: o.server_port,
        password: o.password,
        transport: transportFrom(o.transport),
        tls: tlsFrom(o.tls),
      };
    case "shadowsocks":
      return {
        id: nodeIdOf("ss", o.server, o.server_port, `${o.method}:${o.password}`),
        type: "ss",
        name: o.tag,
        server: o.server,
        port: o.server_port,
        method: o.method,
        password: o.password,
      };
    case "hysteria2":
      return {
        id: nodeIdOf("hysteria2", o.server, o.server_port, o.password || ""),
        type: "hysteria2",
        name: o.tag,
        server: o.server,
        port: o.server_port,
        password: o.password,
        tls: { ...tlsFrom(o.tls), enabled: true },
        obfs: o.obfs ? { type: "salamander", password: o.obfs.password } : undefined,
        upMbps: o.up_mbps,
        downMbps: o.down_mbps,
      };
    case "hysteria":
      return {
        id: nodeIdOf("hysteria", o.server, o.server_port, o.auth_str || ""),
        type: "hysteria",
        name: o.tag,
        server: o.server,
        port: o.server_port,
        password: o.auth_str || "",
        tls: { ...tlsFrom(o.tls), enabled: true },
        obfs: o.obfs ? { type: o.obfs.type, password: o.obfs.password } : undefined,
        upMbps: o.up_mbps,
        downMbps: o.down_mbps,
      };
    case "tuic":
      return {
        id: nodeIdOf("tuic", o.server, o.server_port, `${o.uuid || ""}:${o.password || ""}`),
        type: "tuic",
        name: o.tag,
        server: o.server,
        port: o.server_port,
        uuid: o.uuid,
        password: o.password || "",
        congestionControl: o.congestion_control,
        udpRelayMode: o.udp_relay_mode as UNode["udpRelayMode"],
        tls: { ...tlsFrom(o.tls), enabled: true },
      };
    default:
      return null;
  }
}

/** 解析 sing-box 完整配置或纯 outbounds 数组 */
export function parseSingbox(text: string): UNode[] {
  const doc = JSON.parse(text) as SbConfig | SbOutbound[];
  const outbounds: SbOutbound[] = Array.isArray(doc) ? doc : doc.outbounds || [];
  const nodes: UNode[] = [];
  for (const o of outbounds) {
    // 跳过 direct/block/dns 等内置出站
    if (!o.server || !o.server_port) continue;
    const n = toUNode(o);
    if (n) nodes.push(n);
  }
  return nodes;
}

function fromUNode(n: UNode): SbOutbound {
  const out: SbOutbound = {
    type: n.type === "ss" ? "shadowsocks" : n.type,
    tag: n.name,
    server: n.server,
    server_port: n.port,
  };

  if (n.tls) {
    out.tls = {
      enabled: n.tls.enabled,
      server_name: n.tls.sni,
      insecure: n.tls.allowInsecure,
      alpn: n.tls.alpn,
      utls: n.tls.fingerprint ? { enabled: true, fingerprint: n.tls.fingerprint } : undefined,
      reality: n.tls.reality
        ? { enabled: true, public_key: n.tls.reality.publicKey, short_id: n.tls.reality.shortId }
        : undefined,
    };
  }

  if (n.transport && n.transport.type !== "tcp") {
    out.transport = {
      type: n.transport.type,
      path: n.transport.path,
      headers: n.transport.host ? { Host: n.transport.host } : undefined,
      service_name: n.transport.serviceName,
    };
  }

  switch (n.type) {
    case "vmess":
      out.uuid = n.uuid;
      out.alter_id = n.alterId ?? 0;
      out.security = n.extra?.scy || "auto";
      break;
    case "vless":
      out.uuid = n.uuid;
      if (n.flow) out.flow = n.flow;
      break;
    case "trojan":
      out.password = n.password;
      break;
    case "ss":
      out.method = n.method;
      out.password = n.password;
      break;
    case "hysteria2":
      out.password = n.password;
      out.tls = { ...out.tls, enabled: true };
      if (n.obfs) out.obfs = { type: n.obfs.type, password: n.obfs.password };
      if (n.upMbps) out.up_mbps = n.upMbps;
      if (n.downMbps) out.down_mbps = n.downMbps;
      break;
    case "hysteria":
      out.auth_str = n.password;
      out.tls = { ...out.tls, enabled: true };
      if (n.obfs) out.obfs = { type: n.obfs.type, password: n.obfs.password };
      if (n.upMbps) out.up_mbps = n.upMbps;
      if (n.downMbps) out.down_mbps = n.downMbps;
      break;
    case "tuic":
      out.uuid = n.uuid;
      out.password = n.password;
      out.tls = { ...out.tls, enabled: true };
      if (n.congestionControl) out.congestion_control = n.congestionControl;
      if (n.udpRelayMode) out.udp_relay_mode = n.udpRelayMode;
      break;
  }
  return out;
}

/**
 * 渲染为可独立运行的完整 sing-box 配置。
 *
 * 早期版本只输出了 outbounds 片段，没有 inbounds/dns，无法被要求"完整 profile"的客户端
 * (如 sing-box for Android/iOS 的订阅导入)直接运行；这里补上一个本地 mixed 入站
 * (127.0.0.1:2080，行为类似 Clash 的 mixed-port)和最小 DNS 配置，
 * 同时保留只提供 outbounds 数组、由客户端自身模板合并 的传统兼容方式的可能——
 * 客户端只需读取本文件的 outbounds 字段即可忽略其余部分。
 */
export function encodeSingbox(nodes: UNode[]): string {
  const outbounds = nodes.map(fromUNode);
  const tags = outbounds.map((o) => o.tag);
  const config = {
    log: { level: "info" },
    dns: {
      servers: [
        { tag: "dns-remote", type: "https", server: "1.1.1.1", detour: "proxy" },
        { tag: "dns-direct", type: "udp", server: "223.5.5.5", detour: "direct" },
      ],
      final: "dns-remote",
    },
    inbounds: [
      { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080, sniff: true },
    ],
    outbounds: [
      { type: "selector", tag: "proxy", outbounds: ["auto", ...tags], default: "auto" },
      { type: "urltest", tag: "auto", outbounds: tags, url: "https://www.gstatic.com/generate_204", interval: "5m" },
      ...outbounds,
      { type: "direct", tag: "direct" },
      { type: "block", tag: "block" },
    ],
    route: {
      rules: [{ action: "sniff" }, { protocol: "dns", action: "hijack-dns" }],
      final: "proxy",
    },
  };
  return JSON.stringify(config, null, 2);
}
