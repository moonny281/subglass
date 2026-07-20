// SubGlass 统一节点模型 (UNode)
// 所有格式(vmess/vless/trojan/ss/hysteria2 分享链接、clash yaml、sing-box json)
// 都先解析成 UNode[]，再从 UNode[] 渲染成目标格式，避免 N×N 转换器。

export type NodeType = "vmess" | "vless" | "trojan" | "ss" | "hysteria" | "hysteria2" | "tuic" | "anytls";

/**
 * 部分协议只有 mihomo(Clash Meta) 内核支持，原版 Clash / 其他基于旧内核的客户端无法识别。
 * 用于前端展示"仅mihomo可用"提示，以及生成 Clash 订阅时的兼容性说明。
 */
export const MIHOMO_ONLY_TYPES: ReadonlySet<NodeType> = new Set(["hysteria", "hysteria2", "tuic", "anytls"]);

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

  // anytls: password 复用 trojan 的 password 字段；TLS 走公用 tls 字段(含 fingerprint)
  // 注意：Xray-core 不支持 anytls，只有 mihomo 和 sing-box 支持
  idleSessionCheckInterval?: number; // 秒，默认 30
  idleSessionTimeout?: number; // 秒，默认 30
  minIdleSession?: number; // 默认 0

  tls?: TlsOpts;
  transport?: TransportOpts;

  // 未识别的原始查询参数，转换时尽量透传，保证信息不丢失
  extra?: Record<string, string>;
}

export interface ImportSource {
  id: string;
  label: string; // 用户可编辑的备注名，如"机场A"
  /**
   * "url": 每次生成订阅都会重新拉取 url 字段指向的链接(可更新)
   * "raw": 直接持久化保存 content 字段中的原始文本(粘贴的分享链接/yaml/json)，
   *        不会主动拉取任何地址；内容本身不会再变化，除非用户手动编辑替换
   */
  type: "url" | "raw";
  url?: string; // type==="url" 时必填：上游订阅链接
  content?: string; // type==="raw" 时必填：原始节点分享链接/clash yaml/sing-box json 文本
  addedAt: number;
}

export type TargetFormat = "clash" | "singbox" | "v2ray";

export interface ProxyChain {
  id: string;
  name: string; // 链名，会作为生成配置里的策略组名/tag，需要和节点名不同以免混淆
  /** 有序节点 id 列表：第一个是入口(离客户端最近)，最后一个是出口(离目标服务器最近)，长度需 >= 2 */
  nodeIds: string[];
}

export interface Profile {
  id: string;
  name: string;
  upstreams: ImportSource[];
  selectedIds: string[]; // 用户勾选的节点 id 列表(跨所有 upstream 合并去重后的池子里选)
  renameMap: Record<string, string>; // nodeId -> 自定义名称
  chains: ProxyChain[]; // 用户手动编排的链式代理(relay chain)
  targets: TargetFormat[]; // 该 profile 已生成过哪些格式的订阅链接
  createdAt: number;
  updatedAt: number;
  /** 手动设置的到期时间(毫秒时间戳)。为空/undefined 表示永不过期。过期后订阅链接会被拒绝访问 */
  expiresAt?: number | null;
}
