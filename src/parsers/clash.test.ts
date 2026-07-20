import { describe, it, expect } from "vitest";
import yaml from "js-yaml";
import { parseClashYaml, encodeClashYaml } from "./clash";

const sampleYaml = `
proxies:
  - name: "Reality-VLESS"
    type: vless
    server: example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    network: tcp
    tls: true
    servername: example.com
    flow: xtls-rprx-vision
    client-fingerprint: chrome
    reality-opts:
      public-key: abcDEF123
      short-id: ab12
  - name: "WS-Trojan"
    type: trojan
    server: trojan.example.com
    port: 443
    password: mypassword
    sni: trojan.example.com
    network: ws
    ws-opts:
      path: /ws
      headers:
        Host: trojan.example.com
  - name: "SS-Node"
    type: ss
    server: ss.example.com
    port: 8388
    cipher: aes-256-gcm
    password: sspassword
  - name: "Hy2-Node"
    type: hysteria2
    server: hy2.example.com
    port: 443
    password: hy2pass
    obfs: salamander
    obfs-password: obfspass
  - name: "Hy-Node"
    type: hysteria
    server: hy.example.com
    port: 443
    auth-str: hyauth
    up: 100
    down: 50
    obfs: xplus
    obfs-param: obfspass
  - name: "Tuic-Node"
    type: tuic
    server: tuic.example.com
    port: 443
    uuid: 11111111-1111-1111-1111-111111111111
    password: tuicpass
    congestion-controller: bbr
    udp-relay-mode: native
  - name: "AnyTLS-Node"
    type: anytls
    server: anytls.example.com
    port: 8443
    password: anytlspass
    sni: anytls.example.com
    idle-session-check-interval: 30
    idle-session-timeout: 30
    min-idle-session: 0
    client-fingerprint: chrome
`;

describe("parseClashYaml", () => {
  it("parses all 7 sample proxies", () => {
    const nodes = parseClashYaml(sampleYaml);
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

  it("parses vless reality fields", () => {
    const [vless] = parseClashYaml(sampleYaml);
    expect(vless.tls?.reality?.publicKey).toBe("abcDEF123");
    expect(vless.tls?.fingerprint).toBe("chrome");
    expect(vless.flow).toBe("xtls-rprx-vision");
  });

  it("parses trojan ws-opts", () => {
    const nodes = parseClashYaml(sampleYaml);
    const trojan = nodes.find((n) => n.type === "trojan")!;
    expect(trojan.transport?.type).toBe("ws");
    expect(trojan.transport?.path).toBe("/ws");
    expect(trojan.transport?.host).toBe("trojan.example.com");
  });

  it("parses hysteria2 obfs", () => {
    const nodes = parseClashYaml(sampleYaml);
    const hy2 = nodes.find((n) => n.type === "hysteria2")!;
    expect(hy2.obfs).toEqual({ type: "salamander", password: "obfspass" });
  });

  it("parses hysteria(v1) auth-str/obfs/bandwidth", () => {
    const nodes = parseClashYaml(sampleYaml);
    const hy = nodes.find((n) => n.type === "hysteria")!;
    expect(hy.password).toBe("hyauth");
    expect(hy.obfs).toEqual({ type: "xplus", password: "obfspass" });
    expect(hy.upMbps).toBe(100);
    expect(hy.downMbps).toBe(50);
  });

  it("parses tuic uuid/password/congestion-control", () => {
    const nodes = parseClashYaml(sampleYaml);
    const tuic = nodes.find((n) => n.type === "tuic")!;
    expect(tuic.uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(tuic.password).toBe("tuicpass");
    expect(tuic.congestionControl).toBe("bbr");
    expect(tuic.udpRelayMode).toBe("native");
  });

  it("parses anytls password/sni/fingerprint/session-pool fields", () => {
    const nodes = parseClashYaml(sampleYaml);
    const anytls = nodes.find((n) => n.type === "anytls")!;
    expect(anytls.password).toBe("anytlspass");
    expect(anytls.tls?.sni).toBe("anytls.example.com");
    expect(anytls.tls?.fingerprint).toBe("chrome");
    expect(anytls.idleSessionCheckInterval).toBe(30);
    expect(anytls.idleSessionTimeout).toBe(30);
    expect(anytls.minIdleSession).toBe(0);
  });

  it("accepts a bare proxies array (no top-level 'proxies:' key)", () => {
    const bareArrayYaml = `
- name: "SS-Node"
  type: ss
  server: ss.example.com
  port: 8388
  cipher: aes-256-gcm
  password: sspassword
`;
    const nodes = parseClashYaml(bareArrayYaml);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("ss");
  });
});

describe("round trip through encodeClashYaml", () => {
  it("re-parses generated yaml back to equivalent nodes", () => {
    const nodes = parseClashYaml(sampleYaml);
    const regenerated = encodeClashYaml(nodes);
    const nodes2 = parseClashYaml(regenerated);
    expect(nodes2).toHaveLength(nodes.length);
    for (let i = 0; i < nodes.length; i++) {
      expect(nodes2[i].type).toBe(nodes[i].type);
      expect(nodes2[i].server).toBe(nodes[i].server);
      expect(nodes2[i].port).toBe(nodes[i].port);
    }
  });

  it("output contains proxy-groups referencing all node names", () => {
    const nodes = parseClashYaml(sampleYaml);
    const out = encodeClashYaml(nodes);
    for (const n of nodes) {
      expect(out).toContain(n.name);
    }
    expect(out).toContain("proxy-groups");
    expect(out).toContain("故障转移");
    expect(out).toContain("负载均衡");
  });

  it("warns about mihomo-only protocols in a leading comment", () => {
    const nodes = parseClashYaml(sampleYaml);
    const out = encodeClashYaml(nodes);
    expect(out).toMatch(/^# 提示/);
    expect(out).toContain("Hy2-Node");
    expect(out).toContain("Hy-Node");
    expect(out).toContain("Tuic-Node");
    expect(out).toContain("AnyTLS-Node");
  });

  it("renders a relay proxy-group for chains, in member order", () => {
    const nodes = parseClashYaml(sampleYaml);
    const [a, b, c] = nodes;
    const out = encodeClashYaml(nodes, [{ id: "chain1", name: "我的三跳链", nodeIds: [a.id, b.id, c.id] }]);
    const parsed = yaml.load(out) as { "proxy-groups": { name: string; type: string; proxies: string[] }[] };
    const relay = parsed["proxy-groups"].find((g) => g.name === "我的三跳链");
    expect(relay?.type).toBe("relay");
    expect(relay?.proxies).toEqual([a.name, b.name, c.name]);
    // 链名也应该出现在主选择器里，方便直接选用整条链
    const selector = parsed["proxy-groups"].find((g) => g.name === "🚀 节点选择");
    expect(selector?.proxies).toContain("我的三跳链");
  });

  it("silently drops a chain with fewer than 2 valid members", () => {
    const nodes = parseClashYaml(sampleYaml);
    const out = encodeClashYaml(nodes, [{ id: "chain1", name: "太短的链", nodeIds: [nodes[0].id] }]);
    expect(out).not.toContain("太短的链");
  });
});
