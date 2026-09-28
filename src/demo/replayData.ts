import capture from "./public-capture.json";
import type { DiscoveredCandidate } from "../contracts/discovery";
import type { RouteEndpoint, RouteResult } from "../contracts/map";
import type { UserIntent } from "../recommendation/model";
import { buildGoalSupplyPolicy, limitCandidatesPerTag } from "../recommendation/goalCandidateSupply";
import { createRealCandidateData } from "../recommendation/realProvider";

export const replayCapture = capture;
const pools = Object.fromEntries(Object.entries(capture.pools).map(([goal, candidates]) => [goal, limitCandidatesPerTag(candidates as DiscoveredCandidate[])]));
export const replayPoolSummary = Object.entries(pools).map(([goal, candidates]) => ({
  goal,
  count: candidates.length,
  tags: candidates.reduce<Record<string, number>>((counts, candidate) => {
    const tag = candidate.classifiedPoiTag!;
    counts[tag] = (counts[tag] ?? 0) + 1;
    return counts;
  }, {}),
}));
export function replayData(intent: UserIntent) {
  if (intent.returnMode === "return_to_start") throw new Error("此离线案例未采集返程路线，请取消返回起点；不会用去程代替返程。");
  const goal = buildGoalSupplyPolicy(intent).goal;
  return createRealCandidateData({ origin: capture.origin as RouteEndpoint & { name: string },
    discoveredCandidates: pools[goal], routes: capture.routes as RouteResult[] });
}
