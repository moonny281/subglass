import { describe, it, expect } from "vitest";
import { detectFormat, parseSubscription, dedupeNodes } from "./detect";
import { b64Encode } from "../util";
import type { UNode } from "../model";

const clashYaml = `
proxies:
  - name: "SS-Node"
    type: ss
    server: ss.example.com
    port: 8388
    cipher: aes-256-gcm
    password: sspassword
`;

const singboxJson = JSON.stringify({
  outbounds: [
    {
      type: "trojan",
      tag: "T",
      server: "t.example.com",
      server_port: 443,
      password: "p",
      tls: { enabled: true, server_name: "t.example.com" },
    },
  ],
});

const uriLine = "ss://" + b64Encode("aes-256-gcm:mypassword") + "@host.example.com:8388#SS-Node";

describe("detectFormat", () => {
  it("detects clash yaml", () => {
    expect(detectFormat(clashYaml)).toBe("clash");
  });
  it("detects singbox json", () => {
    expect(detectFormat(singboxJson)).toBe("singbox");
  });
  it("falls back to uri-list", () => {
    expect(detectFormat(uriLine)).toBe("uri-list");
  });
});

describe("parseSubscription", () => {
  it("parses clash yaml content", () => {
    const nodes = parseSubscription(clashYaml);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("ss");
  });

  it("parses singbox json content", () => {
    const nodes = parseSubscription(singboxJson);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("trojan");
  });

  it("parses a plain newline-separated uri list", () => {
    const text = [uriLine, uriLine.replace("SS-Node", "SS-Node-2")].join("\n");
    const nodes = parseSubscription(text);
    expect(nodes).toHaveLength(2);
  });

  it("parses a base64-wrapped uri list (v2rayN subscription format)", () => {
    const raw = [uriLine, uriLine.replace("SS-Node", "SS-Node-2")].join("\n");
    const wrapped = b64Encode(raw);
    const nodes = parseSubscription(wrapped);
    expect(nodes).toHaveLength(2);
  });

  it("returns empty array for empty/garbage input instead of throwing", () => {
    expect(parseSubscription("")).toEqual([]);
    expect(parseSubscription("   ")).toEqual([]);
    expect(parseSubscription("total garbage !!! not a sub")).toEqual([]);
  });
});

describe("dedupeNodes", () => {
  it("keeps only one node per id, last write wins", () => {
    const a: UNode = { id: "x", type: "ss", name: "A", server: "s", port: 1 };
    const b: UNode = { id: "x", type: "ss", name: "B", server: "s", port: 1 };
    const c: UNode = { id: "y", type: "ss", name: "C", server: "s2", port: 2 };
    const result = dedupeNodes([a, b, c]);
    expect(result).toHaveLength(2);
    expect(result.find((n) => n.id === "x")?.name).toBe("B");
  });
});
