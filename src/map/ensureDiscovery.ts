import type { DiscoverySnapshot } from "../contracts/discovery";
import type { SearchPolicy } from "../contracts/search";
import { discoveryEnvelope } from "./discoveryEnvelope";

export type RefreshDiscovery = (policy: SearchPolicy, signal: AbortSignal) => Promise<DiscoverySnapshot>;

export async function ensureDiscovery(snapshot: DiscoverySnapshot, policy: SearchPolicy,
  signal: AbortSignal, refresh?: RefreshDiscovery): Promise<DiscoverySnapshot> {
  signal.throwIfAborted();
  const required = discoveryEnvelope(policy.availableMinutes);
  if (snapshot.envelope?.mode === "walking" && snapshot.envelope.radiusMeters >= required.radiusMeters &&
      policy.entries.every(entry => snapshot.searchedCategories.includes(entry.category))) return snapshot;
  if (!refresh) throw new Error("请打开真实地图并重新发现候选，以更新搜索范围。");
  const updated = await refresh(policy, signal);
  signal.throwIfAborted();
  if (updated.result.status === "error") throw new Error("扩大范围搜索未成功，请稍后重试。没有使用模拟候选。");
  return updated;
}
