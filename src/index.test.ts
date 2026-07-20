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
    ADMIN_USERNAME: "admin",
    ADMIN_PASSWORD: "test-admin-password",
    ...overrides,
  };
}

function loginRequest(body: Record<string, unknown>): Request {
  return new Request("https://sub.example.com/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/login 部署配置自检 (回归: 漏配环境变量/绑定时不应裸露500)", () => {
  it("未配置任何登录凭证时返回带说明的 500，而不是抛出未捕获异常", async () => {
    const env = makeEnv({ ADMIN_USERNAME: undefined, ADMIN_PASSWORD: undefined, ADMIN_TOKEN: undefined });
    const res = await worker.fetch(loginRequest({ username: "admin", password: "anything" }), env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("登录凭证");
  });

  it("SUBGLASS_KV 未绑定时返回带说明的 500，而不是抛出未捕获异常", async () => {
    const env = makeEnv({ SUBGLASS_KV: undefined as unknown as Env["SUBGLASS_KV"] });
    const res = await worker.fetch(loginRequest({ username: "admin", password: "test-admin-password" }), env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("SUBGLASS_KV");
  });

  it("用户名密码模式：正确凭证能登录成功并拿到 Set-Cookie", async () => {
    const env = makeEnv();
    const res = await worker.fetch(loginRequest({ username: "admin", password: "test-admin-password" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeTruthy();
  });

  it("用户名密码模式：密码错误返回 401，而不是 500", async () => {
    const env = makeEnv();
    const res = await worker.fetch(loginRequest({ username: "admin", password: "wrong" }), env);
    expect(res.status).toBe(401);
  });

  it("用户名密码模式：用户名错误也应拒绝(不能只校验密码)", async () => {
    const env = makeEnv();
    const res = await worker.fetch(loginRequest({ username: "someone-else", password: "test-admin-password" }), env);
    expect(res.status).toBe(401);
  });

  it("旧版单令牌模式：未配置用户名密码时，密码框填令牌即可登录", async () => {
    const env = makeEnv({ ADMIN_USERNAME: undefined, ADMIN_PASSWORD: undefined, ADMIN_TOKEN: "legacy-token" });
    const res = await worker.fetch(loginRequest({ username: "", password: "legacy-token" }), env);
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toBeTruthy();
  });

  it("任意其他未预期的异常也会被顶层兜底捕获为 500 JSON，而不是让请求裸奔崩溃", async () => {
    const env = makeEnv({
      SUBGLASS_KV: {
        get: async () => {
          throw new Error("模拟意外的 KV 故障");
        },
      } as unknown as Env["SUBGLASS_KV"],
    });
    const res = await worker.fetch(loginRequest({ username: "admin", password: "test-admin-password" }), env);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("模拟意外的 KV 故障");
  });
});

describe("GET /s/:id 订阅端点：到期时间", () => {
  async function loginAndGetCookie(env: Env): Promise<string> {
    const res = await worker.fetch(loginRequest({ username: "admin", password: "test-admin-password" }), env);
    const setCookie = res.headers.get("Set-Cookie")!;
    return setCookie.split(";")[0];
  }

  async function createProfileWithNode(env: Env, cookie: string, patch: Record<string, unknown> = {}) {
    const createRes = await worker.fetch(
      new Request("https://sub.example.com/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: "测试方案",
          upstreams: [
            {
              label: "手动节点",
              content:
                "vmess://" +
                btoa(
                  JSON.stringify({
                    v: "2",
                    ps: "n1",
                    add: "1.2.3.4",
                    port: "443",
                    id: "11111111-1111-1111-1111-111111111111",
                    aid: "0",
                    net: "tcp",
                    type: "none",
                    tls: "",
                  }),
                ),
            },
          ],
        }),
      }),
      env,
    );
    const profile = (await createRes.json()) as { id: string };

    const poolRes = await worker.fetch(
      new Request(`https://sub.example.com/api/profile/${profile.id}/pool`, { headers: { Cookie: cookie } }),
      env,
    );
    const pool = (await poolRes.json()) as { nodes: { id: string }[] };

    const patchBody = { selectedIds: pool.nodes.map((n) => n.id), ...patch };
    const updateRes = await worker.fetch(
      new Request(`https://sub.example.com/api/profile/${profile.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify(patchBody),
      }),
      env,
    );
    return (await updateRes.json()) as { id: string };
  }

  it("未过期的订阅正常返回内容", async () => {
    const env = makeEnv();
    const cookie = await loginAndGetCookie(env);
    const profile = await createProfileWithNode(env, cookie, { expiresAt: Date.now() + 1000 * 60 * 60 });

    const res = await worker.fetch(new Request(`https://sub.example.com/s/${profile.id}?target=v2ray`), env);
    expect(res.status).toBe(200);
  });

  it("已过期的订阅返回 410，而不是照常下发节点", async () => {
    const env = makeEnv();
    const cookie = await loginAndGetCookie(env);
    const profile = await createProfileWithNode(env, cookie, { expiresAt: Date.now() - 1000 });

    const res = await worker.fetch(new Request(`https://sub.example.com/s/${profile.id}?target=v2ray`), env);
    expect(res.status).toBe(410);
  });
});

describe("链式代理 (relay chain)", () => {
  async function loginAndGetCookie(env: Env): Promise<string> {
    const res = await worker.fetch(loginRequest({ username: "admin", password: "test-admin-password" }), env);
    const setCookie = res.headers.get("Set-Cookie")!;
    return setCookie.split(";")[0];
  }

  function vmessLink(name: string, host: string): string {
    const json = JSON.stringify({
      v: "2",
      ps: name,
      add: host,
      port: "443",
      id: "11111111-1111-1111-1111-111111111111",
      aid: "0",
      net: "tcp",
      type: "none",
      tls: "",
    });
    // btoa 只支持 Latin1，节点名是中文时会报错，这里用标准 API 组合出 UTF-8 安全的编码，
    // 避免引入 Buffer（这个项目跑在 Cloudflare Workers 运行时，没有装 @types/node）
    return "vmess://" + btoa(unescape(encodeURIComponent(json)));
  }

  async function createProfileWithThreeNodes(env: Env, cookie: string) {
    const createRes = await worker.fetch(
      new Request("https://sub.example.com/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({
          name: "链式测试方案",
          upstreams: [
            {
              label: "三个节点",
              content: [vmessLink("入口", "1.1.1.1"), vmessLink("中转", "2.2.2.2"), vmessLink("出口", "3.3.3.3")].join(
                "\n",
              ),
            },
          ],
        }),
      }),
      env,
    );
    const profile = (await createRes.json()) as { id: string };
    const poolRes = await worker.fetch(
      new Request(`https://sub.example.com/api/profile/${profile.id}/pool`, { headers: { Cookie: cookie } }),
      env,
    );
    const pool = (await poolRes.json()) as { nodes: { id: string; name: string }[] };
    return { profileId: profile.id, nodes: pool.nodes };
  }

  it("不单独勾选任何节点、只保存一条链，订阅也能正常生成(不报'未选择节点')", async () => {
    const env = makeEnv();
    const cookie = await loginAndGetCookie(env);
    const { profileId, nodes } = await createProfileWithThreeNodes(env, cookie);

    const addChainRes = await worker.fetch(
      new Request(`https://sub.example.com/api/profile/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ addChain: { name: "三跳链", nodeIds: nodes.map((n) => n.id) } }),
      }),
      env,
    );
    expect(addChainRes.status).toBe(200);

    const res = await worker.fetch(new Request(`https://sub.example.com/s/${profileId}?target=clash`), env);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("relay");
    expect(body).toContain("三跳链");
  });

  it("链少于2个有效节点时，创建接口直接拒绝(400)", async () => {
    const env = makeEnv();
    const cookie = await loginAndGetCookie(env);
    const { profileId, nodes } = await createProfileWithThreeNodes(env, cookie);

    const res = await worker.fetch(
      new Request(`https://sub.example.com/api/profile/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ addChain: { name: "太短", nodeIds: [nodes[0].id] } }),
      }),
      env,
    );
    expect(res.status).toBe(400);
  });

  it("sing-box 输出里链的最后一跳 detour 指向前一跳，形成串联", async () => {
    const env = makeEnv();
    const cookie = await loginAndGetCookie(env);
    const { profileId, nodes } = await createProfileWithThreeNodes(env, cookie);

    await worker.fetch(
      new Request(`https://sub.example.com/api/profile/${profileId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ addChain: { name: "三跳链", nodeIds: nodes.map((n) => n.id) } }),
      }),
      env,
    );

    const res = await worker.fetch(new Request(`https://sub.example.com/s/${profileId}?target=singbox`), env);
    const config = (await res.json()) as { outbounds: { tag: string; detour?: string }[] };
    const lastHop = config.outbounds.find((o) => o.tag === "三跳链");
    expect(lastHop?.detour).toBe("三跳链 · hop2");
  });
});
