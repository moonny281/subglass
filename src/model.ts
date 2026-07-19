// SubGlass 统一节点模型 (UNode)
// 所有格式(vmess/vless/trojan/ss/hysteria2 分享链接、clash yaml、sing-box json)
// 都先解析成 UNode[]，再从 UNode[] 渲染成目标格式，避免 N×N 转换器。

export type NodeType = "vmess" | "vless" | "trojan" | "ss" | "hysteria" | "hysteria2" | "tuic";

/**
 * 部分协议只有 mihomo(Clash Meta) 内核支持，原版 Clash / 其他基于旧内核的客户端无法识别。
 * 用于前端展示"仅mihomo可用"提示，以及生成 Clash 订阅时的兼容性说明。
 */
export const MIHOMO_ONLY_TYPES: ReadonlySet<NodeType> = new Set(["hysteria", "hysteria2", "tuic"]);

export type TransportType = "tcp" | "ws" | "grpc" | "http" | "quic";

export interface RealityOpts {
  publicKey: string;
  shortId?: string;
  spiderX?: string;
}

export interface TlsOpts {
  enabled: boolean;
  sni?: string;
  fingerprint?: string; // uTLS fingerprint, e.g. chrome/firefox/random
  alpn?: string[];
  allowInsecure?: boolean;
  reality?: RealityOpts;
}

export interface TransportOpts {
  type: TransportType;
  path?: string;
  host?: string; // ws/http Host header
  serviceName?: string; // grpc
}

export interface UNode {
  id: string; // 由内容 hash 生成的稳定 id，用于去重/选择
  type: NodeType;
  name: string;
  server: string;
  port: number;

  // vmess / vless
  uuid?: string;
  alterId?: number; // vmess only, 现代客户端通常固定为 0
  flow?: string; // vless xtls flow, e.g. xtls-rprx-vision

  // trojan / ss / hysteria2
  password?: string;

  // shadowsocks
  method?: string; // 如 aes-256-gcm / chacha20-ietf-poly1305 / 2022-blake3-aes-256-gcm

  // hysteria(v1) / hysteria2 共用: password 字段兼作 hysteria(v1) 的 auth-str
  obfs?: { type: string; password: string }; // hysteria2: salamander；hysteria(v1): xplus
  upMbps?: number;
  downMbps?: number;
  protocol?: string; // hysteria(v1) 底层承载协议，默认 udp，可选 wechat-video / faketcp

  // tuic (v5): uuid 复用 vmess/vless 的 uuid 字段，password 复用 trojan 的 password 字段
  congestionControl?: string; // bbr(默认) / cubic / new_reno
  udpRelayMode?: "native" | "quic";

  tls?: TlsOpts;
  transport?: TransportOpts;

  // 未识别的原始查询参数，转换时尽量透传，保证信息不丢失
  extra?: Record<string, string>;
}

export interface ImportSource {
  id: string;
  label: string; // 用户可编辑的备注名，如"机场A"
  url: string; // 上游订阅链接
  addedAt: number;
}

export type TargetFormat = "clash" | "singbox" | "v2ray";

export interface Profile {
  id: string;
  name: string;
  upstreams: ImportSource[];
  selectedIds: string[]; // 用户勾选的节点 id 列表(跨所有 upstream 合并去重后的池子里选)
  renameMap: Record<string, string>; // nodeId -> 自定义名称
  targets: TargetFormat[]; // 该 profile 已生成过哪些格式的订阅链接
  createdAt: number;
  updatedAt: number;
}
