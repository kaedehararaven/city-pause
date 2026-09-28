import { travelLimitSeconds } from "../contracts/mobility";
import type { RoutePreparationAudit } from "../contracts/mobility";
import { routeMetrics, validRouteMetrics } from "../contracts/map";
import { discoveryEnvelope } from "./discoveryEnvelope";
import type { DiscoverySnapshot } from "../contracts/discovery";
import type { RouteEndpoint, RouteResult, TravelMode } from "../contracts/map";
import type { UserIntent } from "../recommendation/model";
import { createRealCandidateData } from "../recommendation/realProvider";
import { fetchWalkingRoute, fetchCyclingRoute } from "./capabilityClient";
import { ROUTE_VALIDATION_BUDGET, selectRouteCandidates } from "./routeValidationPolicy";
import { attachCandidateFunnel, clearLatestRouteAudit, RoutePreparationError } from "./supplyDiagnostics";
import { observeLocation } from "./tempLocationDiagnostics"; // TEMP DEBUG
import { loadPlaceDetails } from "./placeDetailLoader";
import { mergeBaiduPlaceDetail } from "./poiAdapter";
export { selectRouteCandidates } from "./routeValidationPolicy";


export type WalkingRequest = Parameters<typeof fetchWalkingRoute>[0];
export type RouteFetcher = (request: WalkingRequest) => Promise<RouteResult>;

export async function prepareRealPlan(
  intent: UserIntent,
  snapshot: DiscoverySnapshot,
  cached: Map<string, RouteResult>,
  signal: AbortSignal,
  fetchRoute: RouteFetcher | undefined = undefined,
  pause: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, ROUTE_VALIDATION_BUDGET.requestIntervalMs)),
  travelMode: TravelMode = "walking",
  allowAllFailed = false,
) {
  signal.throwIfAborted();
  clearLatestRouteAudit(travelMode);
  if (snapshot.envelope && (snapshot.envelope.mode !== travelMode || snapshot.envelope.radiusMeters < discoveryEnvelope(intent.availableMinutes, travelMode).radiusMeters)) {
    throw new Error("当前搜索范围不足，请按新的时间或交通方式重新发现候选。");
  }
  const fetcher = fetchRoute ?? (travelMode === "walking" ? fetchWalkingRoute : fetchCyclingRoute);
  const audit: RoutePreparationAudit = { discovered: snapshot.result.candidates.length, travelMode, candidateLimit: snapshot.result.candidates.length,
    prepared: 0, requested: 0, cached: 0, successful: 0, failed: { no_route: 0, timeout: 0, provider_error: 0 } };
  const places = selectRouteCandidates(intent, snapshot).map(candidate => ({ ...candidate }));
  const routes: RouteResult[] = [];
  let requests = 0;
  const route = async (from: RouteEndpoint, to: RouteEndpoint, destinationUid?: string) => {
    signal.throwIfAborted();
    const key = JSON.stringify([travelMode, from, to]);
    const sameEndpoint = (a: RouteEndpoint, b: RouteEndpoint) => a.id === b.id && a.location.coordinateSystem === b.location.coordinateSystem &&
      a.location.latitude === b.location.latitude && a.location.longitude === b.location.longitude;
    const previous = cached.get(key);
    if (previous?.status === "success" && previous.mode === travelMode && previous.source === "real" &&
        previous.provider === "baidu" && previous.coordinateSystem === "BD-09" && sameEndpoint(previous.from, from) &&
        sameEndpoint(previous.to, to) && validRouteMetrics(previous)) { audit.cached++; audit.successful++; return previous; }
    if (requests > 0) await pause();
    signal.throwIfAborted();
    // Finish this request before starting any subsequent one; cancellation prevents further calls.
    let result: RouteResult;
    try { result = await fetcher({ from, to, destinationUid }); }
    catch { result = { status: "provider_error", source: "real", provider: "baidu", mode: travelMode, coordinateSystem: "BD-09", from, to }; }
    if (result.mode !== travelMode || result.source !== "real" || result.provider !== "baidu" || result.coordinateSystem !== "BD-09" ||
        !sameEndpoint(result.from, from) || !sameEndpoint(result.to, to) || (result.status === "success" && !validRouteMetrics(result))) {
      result = { status: "provider_error", source: "real", provider: "baidu", mode: travelMode, coordinateSystem: "BD-09", from, to };
    }
    if (result.status !== "success") result = { status: result.status, source: "real", provider: "baidu", mode: travelMode, coordinateSystem: "BD-09", from, to };
    audit.requested++;
    if (result.status === "success") audit.successful++; else audit.failed[result.status]++;
    requests++;
    signal.throwIfAborted();
    if (result.status === "success") cached.set(key, result);
    return result;
  };
  for (let index = 0; index < places.length; index++) {
    const candidate = places[index];
    signal.throwIfAborted();
    // Reuse the same bounded detail cache as the display, before making a
    // decision. A failed optional detail fetch does not fabricate evidence.
    try {
      if (!candidate.classifiedPoiTag && (!candidate.poi.detailExpiresAt || candidate.poi.detailExpiresAt <= Date.now())) {
        candidate.poi = mergeBaiduPlaceDetail(candidate.poi, await loadPlaceDetails(candidate.poi));
      }
    }
    catch { /* Keep existing facts; absent fields remain UNKNOWN. */ }
    signal.throwIfAborted();
    const poi = candidate.poi;
    const destination = { id: poi.providerId, location: poi.location };
    if (import.meta.env.DEV) observeLocation("route", snapshot.origin.location, "prepareRealPlan outbound snapshot.origin (live calculation; may reuse cache)");
    const outbound = await route(snapshot.origin, destination, poi.providerId);
    routes.push(outbound);
    if (outbound.status !== "success" ||
        routeMetrics(outbound).durationSeconds > travelLimitSeconds(intent)) {
      // Failed or over-budget representatives must not suppress a whole category.
    } else if (intent.returnMode === "return_to_start") {
      const back = await route(destination, snapshot.origin);
      routes.push(back);
    }

  }
  const data = createRealCandidateData({ travelMode, origin: snapshot.origin, discoveredCandidates: places, routes });
  audit.prepared = places.length;
  attachCandidateFunnel(intent, snapshot, data, audit);
  if (!allowAllFailed && places.length && !routes.some(result => result.status === "success" && result.from.id === snapshot.origin.id)) {
    throw new RoutePreparationError("候选地点的真实去程路线均不可用，请稍后重试。没有使用模拟路线。", audit);
  }
  return data;
}


// Explicit opt-in: the current UI keeps its walking-only path and quota.
export async function prepareRealMobilityPools(intent: UserIntent, snapshots: Record<TravelMode, DiscoverySnapshot>,
  cached: Map<string, RouteResult>, signal: AbortSignal,
  fetchers?: Record<TravelMode, RouteFetcher>, pause?: () => Promise<void>) {
  const pools = {} as Record<TravelMode, import("../recommendation/model").CandidateData>;
  for (const mode of ["walking", "cycling"] as const) {
    if (mode === "cycling") await (pause?.() ?? new Promise(resolve => setTimeout(resolve, ROUTE_VALIDATION_BUDGET.requestIntervalMs)));
    pools[mode] = await prepareRealPlan(intent, snapshots[mode], cached, signal, fetchers?.[mode], pause, mode, true);
  }
  return pools;
}
