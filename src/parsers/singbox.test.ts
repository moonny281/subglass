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
    // 应被跳过的非代理出站
    { type: "direct", tag: "direct" },
  ],
};

describe("parseSingbox", () => {
  it("parses 4 proxy outbounds and skips direct/block", () => {
    const nodes = parseSingbox(JSON.stringify(sampleConfig));
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => n.type)).toEqual(["vless", "trojan", "ss", "hysteria2"]);
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
    expect(nodes).toHaveLength(4);
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
});
