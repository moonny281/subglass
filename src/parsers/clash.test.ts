import { describe, it, expect } from "vitest";
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
`;

describe("parseClashYaml", () => {
  it("parses all 4 sample proxies", () => {
    const nodes = parseClashYaml(sampleYaml);
    expect(nodes).toHaveLength(4);
    expect(nodes.map((n) => n.type)).toEqual(["vless", "trojan", "ss", "hysteria2"]);
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
  });
});
