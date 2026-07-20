import { describe, it, expect } from "vitest";
import { parseSingbox, encodeSingbox } from "./singbox";

const sampleConfig = {
  outbounds: [
    {
      type: "vless",
      tag: "Reality-VLESS",
      server: "example.com",
      server_port: 443,
      uuid: "11111111-1111-1111-1111-111111111111",
      flow: "xtls-rprx-vision",
      tls: {
        enabled: true,
        server_name: "example.com",
        utls: { enabled: true, fingerprint: "chrome" },
        reality: { enabled: true, public_key: "abcDEF123", short_id: "ab12" },
      },
    },
    {
      type: "trojan",
      tag: "WS-Trojan",
      server: "trojan.example.com",
      server_port: 443,
      password: "mypassword",
      tls: { enabled: true, server_name: "trojan.example.com" },
      transport: { type: "ws", path: "/ws", headers: { Host: "trojan.example.com" } },
    },
    {
      type: "shadowsocks",
      tag: "SS-Node",
      server: "ss.example.com",
      server_port: 8388,
      method: "aes-256-gcm",
      password: "sspassword",
    },
    {
      type: "hysteria2",
      tag: "Hy2-Node",
      server: "hy2.example.com",
      server_port: 443,
      password: "hy2pass",
      obfs: { type: "salamander", password: "obfspass" },
    },
    {
      type: "hysteria",
      tag: "Hy-Node",
      server: "hy.example.com",
      server_port: 443,
      auth_str: "hyauth",
      up_mbps: 100,
      down_mbps: 50,
      obfs: { type: "xplus", password: "obfspass" },
    },
    {
      type: "tuic",
      tag: "Tuic-Node",
      server: "tuic.example.com",
      server_port: 443,
      uuid: "11111111-1111-1111-1111-111111111111",
      password: "tuicpass",
      congestion_control: "bbr",
      udp_relay_mode: "native",
    },
    {
      type: "anytls",
      tag: "AnyTLS-Node",
      server: "anytls.example.com",
      server_port: 8443,
      password: "anytlspass",
      idle_session_check_interval: "30s",
      idle_session_timeout: "60s",
      min_idle_session: 4,
      tls: { enabled: true, server_name: "anytls.example.com", utls: { enabled: true, fingerprint: "chrome" } },
    },
    // 应被跳过的非代理出站
    { type: "direct", tag: "direct" },
  ],
};

describe("parseSingbox", () => {
  it("parses 7 proxy outbounds and skips direct/block", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    expect(nodes).toHaveLength(7);
    expect(nodes.map((n) => n.type)).toEqual([
      "vless",
      "trojan",
      "ss",
      "hysteria2",
      "hysteria",
      "tuic",
      "anytls",
    ]);
  });

  it("parses hysteria(v1) auth_str/obfs/bandwidth", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const hy = nodes.find((n) => n.type === "hysteria")!;
    expect(hy.password).toBe("hyauth");
    expect(hy.obfs).toEqual({ type: "xplus", password: "obfspass" });
    expect(hy.upMbps).toBe(100);
    expect(hy.downMbps).toBe(50);
  });

  it("parses anytls password/session-pool/fingerprint, converting duration strings to seconds", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const anytls = nodes.find((n) => n.type === "anytls")!;
    expect(anytls.password).toBe("anytlspass");
    expect(anytls.idleSessionCheckInterval).toBe(30);
    expect(anytls.idleSessionTimeout).toBe(60);
    expect(anytls.minIdleSession).toBe(4);
    expect(anytls.tls?.fingerprint).toBe("chrome");
  });

  it("parses tuic uuid/password/congestion_control", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const tuic = nodes.find((n) => n.type === "tuic")!;
    expect(tuic.uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(tuic.password).toBe("tuicpass");
    expect(tuic.congestionControl).toBe("bbr");
    expect(tuic.udpRelayMode).toBe("native");
  });

  it("parses reality + utls fingerprint", () => {
    const [vless] = parseSingbox(JSON.stringify(sampleConfig));
    expect(vless.tls?.reality?.publicKey).toBe("abcDEF123");
    expect(vless.tls?.fingerprint).toBe("chrome");
  });

  it("parses ws transport headers", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const trojan = nodes.find((n) => n.type === "trojan")!;
    expect(trojan.transport?.path).toBe("/ws");
    expect(trojan.transport?.host).toBe("trojan.example.com");
  });

  it("accepts a bare outbounds array", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig.outbounds));
    expect(nodes).toHaveLength(7);
  });
});

describe("round trip through encodeSingbox", () => {
  it("re-parses generated config back to equivalent nodes", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const regenerated = encodeSingbox(nodes);
    const nodes2 = parseSingbox(regenerated);
    expect(nodes2).toHaveLength(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      expect(nodes2[i].type).toBe(nodes[i].type);
      expect(nodes2[i].server).toBe(nodes[i].server);
    }
  });

  it("includes selector and urltest outbounds", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const out = JSON.parse(encodeSingbox(nodes));
    const types = out.outbounds.map((o: { type: string }) => o.type);
    expect(types).toContain("selector");
    expect(types).toContain("urltest");
  });

  it("produces a standalone-runnable config with inbounds + dns", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const out = JSON.parse(encodeSingbox(nodes));
    expect(out.inbounds?.[0]?.type).toBe("mixed");
    expect(out.dns?.servers?.length).toBeGreaterThan(0);
    expect(out.route?.final).toBe("proxy");
  });

  it("chains nodes via detour, first hop has no detour, last hop tag = chain name", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const [a, b, c] = nodes;
    const out = JSON.parse(encodeSingbox(nodes, [{ id: "chain1", name: "我的三跳链", nodeIds: [a.id, b.id, c.id] }]));
    const byTag = new Map(out.outbounds.map((o: { tag: string }) => [o.tag, o]));

    const hop1 = byTag.get(`我的三跳链 · hop1`) as { detour?: string; server: string } | undefined;
    const hop2 = byTag.get(`我的三跳链 · hop2`) as { detour?: string; server: string } | undefined;
    const hop3 = byTag.get(`我的三跳链`) as { detour?: string; server: string } | undefined;

    expect(hop1?.detour).toBeUndefined();
    expect(hop1?.server).toBe(a.server);
    expect(hop2?.detour).toBe("我的三跳链 · hop1");
    expect(hop2?.server).toBe(b.server);
    expect(hop3?.detour).toBe("我的三跳链 · hop2");
    expect(hop3?.server).toBe(c.server);

    // 只有代表整条链的最后一跳会暴露给顶层 selector，中间跳不应该出现在可选项里
    const selector = out.outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(selector.outbounds).toContain("我的三跳链");
    expect(selector.outbounds).not.toContain("我的三跳链 · hop1");
  });

  it("skips a chain with fewer than 2 valid members", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    const out = JSON.parse(encodeSingbox(nodes, [{ id: "chain1", name: "太短的链", nodeIds: [nodes[0].id] }]));
    const tags = out.outbounds.map((o: { tag: string }) => o.tag);
    expect(tags).not.toContain("太短的链");
  });
});
