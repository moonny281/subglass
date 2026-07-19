import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkLoginRateLimit, recordLoginAttempt } from "./ratelimit";
import type { Env } from "./env";

/** 极简内存 KV mock，只实现本模块用到的 get/put/delete */
function createMockKv() {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    async put(key: string, value: string) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

function mockEnv(): Env {
  return { SUBGLASS_KV: createMockKv() as unknown as Env["SUBGLASS_KV"], ASSETS: {} as Env["ASSETS"], ADMIN_TOKEN: "secret" };
}

describe("login rate limiting", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("allows requests when no prior attempts", async () => {
    const env = mockEnv();
    const gate = await checkLoginRateLimit(env, "1.2.3.4");
    expect(gate.allowed).toBe(true);
  });

  it("locks out after 5 consecutive failures", async () => {
    const env = mockEnv();
    for (let i = 0; i < 5; i++) {
      await recordLoginAttempt(env, "1.2.3.4", false);
    }
    const gate = await checkLoginRateLimit(env, "1.2.3.4");
    expect(gate.allowed).toBe(false);
    expect(gate.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not lock out a different IP", async () => {
    const env = mockEnv();
    for (let i = 0; i < 5; i++) {
      await recordLoginAttempt(env, "1.2.3.4", false);
    }
    const gate = await checkLoginRateLimit(env, "5.6.7.8");
    expect(gate.allowed).toBe(true);
  });

  it("a successful login clears the failure counter", async () => {
    const env = mockEnv();
    await recordLoginAttempt(env, "1.2.3.4", false);
    await recordLoginAttempt(env, "1.2.3.4", false);
    await recordLoginAttempt(env, "1.2.3.4", true);
    // 再失败4次不应该触发锁定(计数器已被成功登录清零)
    for (let i = 0; i < 4; i++) {
      await recordLoginAttempt(env, "1.2.3.4", false);
    }
    const gate = await checkLoginRateLimit(env, "1.2.3.4");
    expect(gate.allowed).toBe(true);
  });

  it("lock expires after the lock window passes", async () => {
    const env = mockEnv();
    const now = Date.now();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    for (let i = 0; i < 5; i++) {
      await recordLoginAttempt(env, "1.2.3.4", false);
    }
    expect((await checkLoginRateLimit(env, "1.2.3.4")).allowed).toBe(false);

    vi.setSystemTime(now + 16 * 60 * 1000); // 16分钟后，超过15分钟锁定窗口
    expect((await checkLoginRateLimit(env, "1.2.3.4")).allowed).toBe(true);
    vi.useRealTimers();
  });
});
