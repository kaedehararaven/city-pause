import capture from "./public-capture.json";
import nearby from "./public-nearby-capture.json";
import multi from "./public-multi-capture.json";
import compact from "./public-compact-capture.json";
import wangfujing from "./public-wangfujing-capture.json";
import restCapture from "./public-rest-capture.json";
import { sameEndpoint } from "../route-builder/edges";
import type { DiscoveredCandidate } from "../contracts/discovery";
import type { RouteEndpoint, RouteResult } from "../contracts/map";
import type { UserIntent } from "../recommendation/model";
import { buildGoalSupplyPolicy, limitCandidatesPerTag } from "../recommendation/goalCandidateSupply";
import { createRealCandidateData } from "../recommendation/realProvider";

const validNearby = sameEndpoint(nearby.origin as RouteEndpoint, capture.origin as RouteEndpoint);
export const replayCapture = {
  ...capture,
  capturedAt: validNearby ? nearby.capturedAt : capture.capturedAt,
  pools: Object.fromEntries(Object.entries(capture.pools).map(([goal, candidates]) => [goal,
    limitCandidatesPerTag([...candidates as DiscoveredCandidate[], ...(validNearby ? (nearby.pools as Record<string, DiscoveredCandidate[]>)[goal] ?? [] : [])])])),
  routes: [...capture.routes as RouteResult[], ...(validNearby ? nearby.routes as RouteResult[] : [])],
};
const pools = replayCapture.pools;
export type ReplayScenario = "compact" | "original";
export const replayOrigins = { compact: wangfujing.origin, original: capture.origin };
const validRestCapture = sameEndpoint(restCapture.origin as RouteEndpoint, replayOrigins.compact as RouteEndpoint);
export const replayRestCandidates = validRestCapture ? restCapture.candidates as DiscoveredCandidate[] : [];
export function replayPools(scenario: ReplayScenario) {
  // The latest search is centered on the compact demo, not the original origin.
  return scenario === "compact" ? { ...pools, rest: limitCandidatesPerTag([...replayRestCandidates, ...pools.rest]) } : pools;
}
export const replayInterStopEdges = [...multi.edges, ...compact.edges, ...wangfujing.edges, ...(validRestCapture ? restCapture.edges : [])] as RouteResult[];
export const replayPoolSummary = (scenario: ReplayScenario) => Object.entries(replayPools(scenario)).map(([goal, candidates]) => ({
  goal,
  count: candidates.length,
  tags: candidates.reduce<Record<string, number>>((counts, candidate) => {
    const tag = candidate.classifiedPoiTag!;
    counts[tag] = (counts[tag] ?? 0) + 1;
    return counts;
  }, {}),
}));
export function replayData(intent: UserIntent, scenario: ReplayScenario = "compact") {
  if (intent.returnMode === "return_to_start") throw new Error("此离线案例未采集返程路线，请取消返回起点；不会用去程代替返程。");
  const goal = buildGoalSupplyPolicy(intent).goal;
  const origin = replayOrigins[scenario] as RouteEndpoint & { name: string };
  return createRealCandidateData({ origin,
    discoveredCandidates: replayPools(scenario)[goal].filter(candidate => candidate.poi.providerId !== origin.id),
    routes: [...replayCapture.routes, ...replayInterStopEdges].filter(route => sameEndpoint(route.from, origin)) });
}
