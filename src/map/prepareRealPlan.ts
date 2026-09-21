import type { DiscoverySnapshot, DiscoveredCandidate } from "../contracts/discovery";
import type { RouteEndpoint, RouteResult } from "../contracts/map";
import type { UserIntent } from "../recommendation/model";
import { buildSearchPolicy } from "../recommendation/searchPolicy";
import { bufferForBudget } from "../recommendation/engine";
import { createRealCandidateData } from "../recommendation/realProvider";
import { fetchWalkingRoute } from "./capabilityClient";
import { DISCOVERY_LIMITS, PRIORITY_ORDER } from "./searchMapping";
import { SEARCH_CATEGORIES } from "../contracts/search";

export const ROUTE_CANDIDATE_LIMIT = 6;
export type WalkingRequest = Parameters<typeof fetchWalkingRoute>[0];
export type RouteFetcher = (request: WalkingRequest) => Promise<RouteResult>;

// A search priority controls which limited routes we acquire, never the recommendation score.
export function selectRouteCandidates(intent: UserIntent, snapshot: DiscoverySnapshot) {
  const policy = buildSearchPolicy(intent);
  const selected: DiscoveredCandidate[] = [];
  const seen = new Set<string>();
  const entries = [...policy.entries].sort((a, b) =>
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    SEARCH_CATEGORIES.indexOf(a.category) - SEARCH_CATEGORIES.indexOf(b.category));
  // Give every available category a first slot before allocating additional slots.
  for (let round = 0; round < DISCOVERY_LIMITS.categorySize.high; round++) {
      for (const entry of entries) {
        if (selected.length === ROUTE_CANDIDATE_LIMIT) return selected;
        if (round >= DISCOVERY_LIMITS.categorySize[entry.priority]) continue;
        const candidate = snapshot.result.candidates.find(candidate =>
          candidate.matchedSearchCategories.includes(entry.category) &&
          !seen.has(JSON.stringify([candidate.poi.provider, candidate.poi.providerId])));
        if (!candidate) continue;
        seen.add(JSON.stringify([candidate.poi.provider, candidate.poi.providerId]));
        selected.push(candidate);
      }
  }
  return selected;
}

export async function prepareRealPlan(
  intent: UserIntent,
  snapshot: DiscoverySnapshot,
  cached: Map<string, RouteResult>,
  signal: AbortSignal,
  fetchRoute: RouteFetcher = fetchWalkingRoute,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 400)),
) {
  signal.throwIfAborted();
  const policy = buildSearchPolicy(intent);
  if (policy.entries.some(entry => !snapshot.searchedCategories.includes(entry.category))) {
    throw new Error("当前候选池未覆盖新的类别，请在地图面板重新发现候选。");
  }
  const places = selectRouteCandidates(intent, snapshot);
  const routes: RouteResult[] = [];
  // These guarantees cannot be established from discovery metadata alone.
  if (intent.avoidCost || intent.excludedKinds.length) {
    return createRealCandidateData({ origin: snapshot.origin, discoveredCandidates: places, routes });
  }
  let requests = 0;
  const route = async (from: RouteEndpoint, to: RouteEndpoint, destinationUid?: string) => {
    signal.throwIfAborted();
    const key = JSON.stringify([from, to]);
    const previous = cached.get(key);
    if (previous?.status === "success") return previous;
    if (requests > 0) await pause();
    signal.throwIfAborted();
    // Finish this request before starting any subsequent one; cancellation prevents further calls.
    const result = await fetchRoute({ from, to, destinationUid });
    requests++;
    signal.throwIfAborted();
    if (result.status === "success") cached.set(key, result);
    return result;
  };
  for (const candidate of places) {
    const poi = candidate.poi;
    const destination = { id: poi.providerId, location: poi.location };
    const outbound = await route(snapshot.origin, destination, poi.providerId);
    routes.push(outbound);
    if (outbound.status !== "success" ||
        outbound.walkingMinutes + 5 + bufferForBudget(intent.availableMinutes) > intent.availableMinutes ||
        (intent.nearby && outbound.walkingMinutes > 5)) continue;
    if (intent.returnMode === "return_to_start") {
      routes.push(await route(destination, snapshot.origin));
    }
  }
  const data = createRealCandidateData({ origin: snapshot.origin, discoveredCandidates: places, routes });
  if (places.length && !routes.some(result => result.status === "success" && result.from.id === snapshot.origin.id)) {
    throw new Error("候选地点的真实去程路线均不可用，请稍后重试。没有使用模拟路线。");
  }
  return data;
}
