import { describe, it, expect } from "vitest";
import { parseUri, encodeUri, tryParseUri } from "./uri";
import { b64Encode } from "../util";

describe("vmess", () => {
  const json = {
    v: "2",
    ps: "测试节点",
    add: "example.com",
    port: "443",
    id: "11111111-1111-1111-1111-111111111111",
    aid: "0",
    net: "ws",
    type: "none",
    host: "example.com",
    path: "/ws",
    tls: "tls",
    sni: "example.com",
    alpn: "h2,http/1.1",
    fp: "chrome",
  };
  const uri = `vmess://${b64Encode(JSON.stringify(json))}`;

  it("parses fields correctly", () => {
    const node = parseUri(uri);
    expect(node.type).toBe("vmess");
    expect(node.name).toBe("测试节点");
    expect(node.server).toBe("example.com");
    expect(node.port).toBe(443);
    expect(node.uuid).toBe(json.id);
    expect(node.transport?.type).toBe("ws");
    expect(node.transport?.path).toBe("/ws");
    expect(node.tls?.enabled).toBe(true);
    expect(node.tls?.alpn).toEqual(["h2", "http/1.1"]);
  });

  it("round-trips through encode -> parse", () => {
    const node = parseUri(uri);
    const reencoded = encodeUri(node);
    const node2 = parseUri(reencoded);
    expect(node2).toMatchObject({
      type: "vmess",
      server: node.server,
      port: node.port,
      uuid: node.uuid,
      name: node.name,
    });
    expect(node2.tls?.sni).toBe(node.tls?.sni);
  });
});

describe("vless", () => {
  const uri =
    "vless://11111111-1111-1111-1111-111111111111@example.com:443" +
    "?encryption=none&security=reality&sni=example.com&fp=chrome" +
    "&pbk=abcDEF123&sid=ab12&type=tcp&flow=xtls-rprx-vision#My%20Node";

  it("parses reality params", () => {
    const node = parseUri(uri);
    expect(node.type).toBe("vless");
    expect(node.name).toBe("My Node");
    expect(node.tls?.reality?.publicKey).toBe("abcDEF123");
    expect(node.tls?.reality?.shortId).toBe("ab12");
    expect(node.flow).toBe("xtls-rprx-vision");
  });

  it("round-trips", () => {
    const node = parseUri(uri);
    const node2 = parseUri(encodeUri(node));
    expect(node2.uuid).toBe(node.uuid);
    expect(node2.tls?.reality?.publicKey).toBe(node.tls?.reality?.publicKey);
    expect(node2.flow).toBe(node.flow);
  });
});

describe("trojan", () => {
  const uri = "trojan://mypassword@host.example.com:443?sni=host.example.com&type=ws&host=host.example.com&path=%2Fpath#Trojan-Node";

  it("parses", () => {
    const node = parseUri(uri);
    expect(node.type).toBe("trojan");
    expect(node.password).toBe("mypassword");
    expect(node.tls?.enabled).toBe(true);
    expect(node.transport?.type).toBe("ws");
    expect(node.transport?.path).toBe("/path");
  });

  it("round-trips", () => {
    const node = parseUri(uri);
    const node2 = parseUri(encodeUri(node));
    expect(node2.password).toBe(node.password);
    expect(node2.transport?.path).toBe(node.transport?.path);
  });
});

describe("shadowsocks", () => {
  it("parses SIP002 base64 userinfo", () => {
    const userinfo = btoa("aes-256-gcm:mypassword");
    const uri = `ss://${userinfo}@host.example.com:8388#SS-Node`;
    const node = parseUri(uri);
    expect(node.type).toBe("ss");
    expect(node.method).toBe("aes-256-gcm");
    expect(node.password).toBe("mypassword");
    expect(node.port).toBe(8388);
  });

  it("parses plaintext userinfo", () => {
    const uri = "ss://aes-256-gcm:mypassword@host.example.com:8388#SS-Node";
    const node = parseUri(uri);
    expect(node.method).toBe("aes-256-gcm");
    expect(node.password).toBe("mypassword");
  });

  it("round-trips", () => {
    const uri = "ss://aes-256-gcm:mypassword@host.example.com:8388#SS-Node";
    const node = parseUri(uri);
    const node2 = parseUri(encodeUri(node));
    expect(node2.method).toBe(node.method);
    expect(node2.password).toBe(node.password);
    expect(node2.server).toBe(node.server);
  });
});

describe("hysteria2", () => {
  const uri = "hysteria2://mypassword@host.example.com:443?sni=host.example.com&insecure=1&obfs=salamander&obfs-password=obfspass#Hy2-Node";

  it("parses obfs and tls", () => {
    const node = parseUri(uri);
    expect(node.type).toBe("hysteria2");
    expect(node.obfs?.type).toBe("salamander");
    expect(node.obfs?.password).toBe("obfspass");
    expect(node.tls?.allowInsecure).toBe(true);
  });

  it("supports hy2:// alias", () => {
    const alias = uri.replace("hysteria2://", "hy2://");
    const node = parseUri(alias);
    expect(node.type).toBe("hysteria2");
  });

  it("round-trips", () => {
    const node = parseUri(uri);
    const node2 = parseUri(encodeUri(node));
    expect(node2.password).toBe(node.password);
    expect(node2.obfs).toEqual(node.obfs);
  });
});

describe("hysteria (v1)", () => {
  const uri =
    "hysteria://host.example.com:443?auth=myauth&peer=host.example.com&insecure=1" +
    "&upmbps=100&downmbps=50&obfs=xplus&obfsParam=obfspass#Hy-Node";

  it("parses auth/obfs/bandwidth", () => {
    const node = parseUri(uri);
    expect(node.type).toBe("hysteria");
    expect(node.password).toBe("myauth");
    expect(node.obfs?.type).toBe("xplus");
    expect(node.obfs?.password).toBe("obfspass");
    expect(node.upMbps).toBe(100);
    expect(node.downMbps).toBe(50);
    expect(node.tls?.allowInsecure).toBe(true);
  });

  it("round-trips", () => {
    const node = parseUri(uri);
    const node2 = parseUri(encodeUri(node));
    expect(node2.password).toBe(node.password);
    expect(node2.obfs).toEqual(node.obfs);
    expect(node2.upMbps).toBe(node.upMbps);
  });
});

describe("tuic", () => {
  const uri =
    "tuic://11111111-1111-1111-1111-111111111111:mypassword@host.example.com:443" +
    "?congestion_control=bbr&udp_relay_mode=native&sni=host.example.com&allow_insecure=1#Tuic-Node";

  it("parses uuid/password/congestion control", () => {
    const node = parseUri(uri);
    expect(node.type).toBe("tuic");
    expect(node.uuid).toBe("11111111-1111-1111-1111-111111111111");
    expect(node.password).toBe("mypassword");
    expect(node.congestionControl).toBe("bbr");
    expect(node.udpRelayMode).toBe("native");
    expect(node.tls?.allowInsecure).toBe(true);
  });

  it("round-trips", () => {
    const node = parseUri(uri);
    const node2 = parseUri(encodeUri(node));
    expect(node2.uuid).toBe(node.uuid);
    expect(node2.password).toBe(node.password);
    expect(node2.congestionControl).toBe(node.congestionControl);
  });
});

describe("tryParseUri", () => {
  it("returns null for garbage instead of throwing", () => {
    expect(tryParseUri("not-a-uri")).toBeNull();
    expect(tryParseUri("http://example.com")).toBeNull();
  });
});
