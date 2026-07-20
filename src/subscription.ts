import type { Env } from "./env";
import type { Profile, UNode, ProxyChain } from "./model";
import { fetchUpstreamCached } from "./kv";
import { parseSubscription, dedupeNodes } from "./parsers/detect";

export class NoNodesSelectedError extends Error {
  constructor() {
    super("该订阅尚未选择任何节点或链式代理，请先在节点管理页勾选后再生成/刷新订阅链接");
    this.name = "NoNodesSelectedError";
  }
}

/** 拉取 profile 所有上游、合并去重后的完整节点池（未经选择/改名过滤） */
export async function buildNodePool(env: Env, profile: Profile): Promise<UNode[]> {
  const results = await Promise.allSettled(
    profile.upstreams.map((u) =>
      u.type === "raw" ? Promise.resolve(u.content || "") : fetchUpstreamCached(env, u.url || ""),
    ),
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

export interface SelectedNodesResult {
  nodes: UNode[];
  /** 校验/清洗过的链：成员都真实存在于当前节点池里，且长度 >= 2 */
  chains: ProxyChain[];
}

/**
 * 组装最终要下发给客户端的节点列表：过滤选择 + 应用自定义改名，
 * 同时把链式代理引用到的节点也一并纳入（哪怕用户没有单独勾选它），
 * 否则生成的 relay/detour 链会引用一个配置里根本不存在的节点。
 */
export async function buildSelectedNodes(env: Env, profile: Profile): Promise<SelectedNodesResult> {
  const hasChains = profile.chains && profile.chains.length > 0;
  if (profile.selectedIds.length === 0 && !hasChains) {
    throw new NoNodesSelectedError();
  }
  const pool = await buildNodePool(env, profile);
  const poolMap = new Map(pool.map((n) => [n.id, n]));

  const applyRename = (node: UNode): UNode => {
    const customName = profile.renameMap[node.id];
    return customName ? { ...node, name: customName } : node;
  };

  const resultMap = new Map<string, UNode>();
  for (const id of profile.selectedIds) {
    const node = poolMap.get(id);
    if (node) resultMap.set(id, applyRename(node)); // 上游节点已下线/改动，静默跳过而不是报错
  }

  const validChains: ProxyChain[] = [];
  for (const chain of profile.chains || []) {
    const memberNodes = chain.nodeIds.map((id) => poolMap.get(id)).filter((n): n is UNode => !!n);
    if (memberNodes.length < 2) continue; // 引用的节点已从上游消失导致链不完整，静默跳过这条链
    for (const n of memberNodes) {
      if (!resultMap.has(n.id)) resultMap.set(n.id, applyRename(n));
    }
    validChains.push({ ...chain, nodeIds: memberNodes.map((n) => n.id) });
  }

  return { nodes: [...resultMap.values()], chains: validChains };
}
