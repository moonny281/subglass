import { describe, it, expect, vi } from "vitest";
import { createSessionToken, verifySessionToken } from "./auth";

describe("session token", () => {
  it("verifies a freshly issued token as valid", async () => {
    const { token } = await createSessionToken("my-admin-secret");
    expect(await verifySessionToken(token, "my-admin-secret")).toBe(true);
  });

  it("rejects a token signed with a different secret", async () => {
    const { token } = await createSessionToken("my-admin-secret");
    expect(await verifySessionToken(token, "wrong-secret")).toBe(false);
  });

  it("rejects a tampered payload (expiry extended)", async () => {
    const { token } = await createSessionToken("my-admin-secret");
    const [, sig] = token.split(".");
    const tampered = `${Date.now() + 1000 * 60 * 60 * 24 * 365}.${sig}`;
    expect(await verifySessionToken(tampered, "my-admin-secret")).toBe(false);
  });

  it("rejects malformed tokens", async () => {
    expect(await verifySessionToken("not-a-valid-token", "secret")).toBe(false);
    expect(await verifySessionToken("", "secret")).toBe(false);
  });

  it("rejects an expired token", async () => {
    const now = Date.now();
    vi.setSystemTime(now);
    const { token } = await createSessionToken("my-admin-secret");
    vi.setSystemTime(now + 25 * 60 * 60 * 1000); // 25小时后，超过24小时有效期
    expect(await verifySessionToken(token, "my-admin-secret")).toBe(false);
    vi.useRealTimers();
  });
});
