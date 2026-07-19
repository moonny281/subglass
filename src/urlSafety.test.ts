import { describe, it, expect } from "vitest";
import { assertSafeUpstreamUrl, UnsafeUrlError } from "./urlSafety";

describe("assertSafeUpstreamUrl", () => {
  it("allows normal https/http public urls", () => {
    expect(() => assertSafeUpstreamUrl("https://sub.example.com/link")).not.toThrow();
    expect(() => assertSafeUpstreamUrl("http://example.com/sub")).not.toThrow();
  });

  it("rejects non-http(s) protocols", () => {
    expect(() => assertSafeUpstreamUrl("file:///etc/passwd")).toThrow(UnsafeUrlError);
    expect(() => assertSafeUpstreamUrl("ftp://example.com/x")).toThrow(UnsafeUrlError);
  });

  it("rejects malformed urls", () => {
    expect(() => assertSafeUpstreamUrl("not a url")).toThrow(UnsafeUrlError);
  });

  it("rejects localhost and loopback", () => {
    expect(() => assertSafeUpstreamUrl("http://localhost:8080/sub")).toThrow(UnsafeUrlError);
    expect(() => assertSafeUpstreamUrl("http://127.0.0.1/sub")).toThrow(UnsafeUrlError);
    expect(() => assertSafeUpstreamUrl("http://[::1]/sub")).toThrow(UnsafeUrlError);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(() => assertSafeUpstreamUrl("http://10.0.0.5/sub")).toThrow(UnsafeUrlError);
    expect(() => assertSafeUpstreamUrl("http://192.168.1.1/sub")).toThrow(UnsafeUrlError);
    expect(() => assertSafeUpstreamUrl("http://172.16.0.1/sub")).toThrow(UnsafeUrlError);
    expect(() => assertSafeUpstreamUrl("http://172.31.255.255/sub")).toThrow(UnsafeUrlError);
    // 172.32.x.x 不在私有段内，应该放行
    expect(() => assertSafeUpstreamUrl("http://172.32.0.1/sub")).not.toThrow();
  });

  it("rejects link-local / cloud metadata range", () => {
    expect(() => assertSafeUpstreamUrl("http://169.254.169.254/latest/meta-data/")).toThrow(UnsafeUrlError);
  });
});
