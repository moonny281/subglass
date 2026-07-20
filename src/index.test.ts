import { describe, it, expect } from "vitest";
import worker from "./index";
import type { Env } from "./env";

/** 极简内存版 KVNamespace mock，只实现代码里实际用到的几个方法 */
function makeFakeKv() {
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
    async list({ prefix = "" }: { prefix?: string } = {}) {
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    SUBGLASS_KV: makeFakeKv() as unknown as Env["SUBGLASS_KV"],
    ASSETS: { fetch: async () => new Response("static-ok") } as unknown as Env["ASSETS"],
    ADMIN_TOKEN: "test-admin-token",
    ...overrides,
  };
}

function loginRequest(token: string): Request {
  return new Request("https://sub.example.com/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
}

describe("POST /api/login 部署配置自检 (回归: 漏配环境变量/绑定时不应裸露500)", () => {
  it("ADMIN_TOKEN 未配置时返回带说明的 500，而不是抛出未捕获异常", async () => {
    // 模拟 undefined 未配置的情况，绕过 TS 的 string 类型标注
    const env = makeEnv({ ADMIN_TOKEN: undefined as unknown as string });
    const res = await worker.fetch(loginRequest("anything"), env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("ADMIN_TOKEN");
  });

  it("SUBGLASS_KV 未绑定时返回带说明的 500，而不是抛出未捕获异常", async () => {
    const env = makeEnv({ SUBGLASS_KV: undefined as unknown as Env["SUBGLASS_KV"] });
    const res = await worker.fetch(loginRequest("test-admin-token"), env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("SUBGLASS_KV");
  });

  it("配置齐全时，正确的令牌能登录成功并拿到 Set-Cookie", async () => {
    const env = makeEnv();
    const res = await worker.fetch(loginRequest("test-admin-token"), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeTruthy();
  });

  it("配置齐全但令牌错误时返回 401，而不是 500", async () => {
    const env = makeEnv();
    const res = await worker.fetch(loginRequest("wrong-token"), env);
    expect(res.status).toBe(401);
  });

  it("任意其他未预期的异常也会被顶层兜底捕获为 500 JSON，而不是让请求裸奔崩溃", async () => {
    const env = makeEnv({
      SUBGLASS_KV: {
        get: async () => {
          throw new Error("模拟意外的 KV 故障");
        },
      } as unknown as Env["SUBGLASS_KV"],
    });
    const res = await worker.fetch(loginRequest("test-admin-token"), env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("模拟意外的 KV 故障");
  });
});
