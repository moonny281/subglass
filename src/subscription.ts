import type { Env } from "./env";
import type { Profile, UNode } from "./model";
import { fetchUpstreamCached } from "./kv";
import { parseSubscription, dedupeNodes } from "./parsers/detect";

export class NoNodesSelectedError extends Error {
  constructor() {
    super("该订阅尚未选择任何节点，请先在节点管理页勾选后再生成/刷新订阅链接");
    this.name = "NoNodesSelectedError";
  }
}

/** 拉取 profile 所有上游、合并去重后的完整节点池（未经选择/改名过滤） */
export async function buildNodePool(env: Env, profile: Profile): Promise<UNode[]> {
  const results = await Promise.allSettled(
    profile.upstreams.map((u) => fetchUpstreamCached(env, u.url)),
  );

  const allNodes: UNode[] = [];
  const failures: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      allNodes.push(...parseSubscription(r.value));
    } else {
      failures.push(`${profile.upstreams[i].label}: ${(r.reason as Error).message}`);
    }
  });

  if (failures.length && allNodes.length === 0) {
    throw new Error(`所有上游拉取失败:\n${failures.join("\n")}`);
  }

  return dedupeNodes(allNodes);
}

/** 组装最终要下发给客户端的节点列表：过滤选择 + 应用自定义改名 */
export async function buildSelectedNodes(env: Env, profile: Profile): Promise<UNode[]> {
  if (profile.selectedIds.length === 0) {
    throw new NoNodesSelectedError();
  }
  const pool = await buildNodePool(env, profile);
  const poolMap = new Map(pool.map((n) => [n.id, n]));

  const selected: UNode[] = [];
  for (const id of profile.selectedIds) {
    const node = poolMap.get(id);
    if (!node) continue; // 上游节点已下线/改动，静默跳过而不是报错
    const customName = profile.renameMap[id];
    selected.push(customName ? { ...node, name: customName } : node);
  }
  return selected;
}
