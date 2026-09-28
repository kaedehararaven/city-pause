import record from "./public-multi-capture.json";
import type { MapPOI, RouteEndpoint, RouteResult } from "../contracts/map";
import type { UserIntent } from "../recommendation/model";
import { edgeKey, sameEndpoint, validEdge, type EdgeCache } from "../route-builder/edges";
import { replayCapture, replayData, replayInterStopEdges, replayRestCandidates, type ReplayScenario } from "./replayData";

export type MultiCapture = {
  version: string; capturedAt: string | null; origin: RouteEndpoint | null;
  pois: MapPOI[]; edges: RouteResult[]; requests: { search: number; routes: number };
};
export const multiCapture = record as MultiCapture;
export function replayMultiData(intent: UserIntent, scenario: ReplayScenario = "compact") {
  const base = replayData(intent, scenario);
  const cache: EdgeCache = new Map();
  const validCapture = multiCapture.origin && sameEndpoint(multiCapture.origin, replayCapture.origin as RouteEndpoint);
  // Cross-goal reuse of stored public facts, reclassified for the current Goal
  // by the supplemental validator. Never reuse a source pool's Goal grade.
  const storedPois = [...Object.values(replayCapture.pools).flat().map(candidate => candidate.poi as MapPOI),
    ...replayRestCandidates.map(candidate => candidate.poi),
    ...(validCapture ? multiCapture.pois : [])].filter(poi => poi.providerId !== base.origin.id);
  const edges = validCapture ? replayInterStopEdges : [];
  for (const edge of edges) {
    const request = { from: edge.from, to: edge.to, destinationUid: edge.to.id };
    if (validEdge(edge, request, "real")) cache.set(edgeKey(request), { route: edge, expiresAt: Infinity });
  }
  // Historical edges deliberately remain offline records, not fresh live cache.
  const routes = [...base.routes];
  for (const edge of edges) if (sameEndpoint(edge.from, base.origin) && !routes.some(r => sameEndpoint(r.from, edge.from) && sameEndpoint(r.to, edge.to))) routes.push(edge);
  return { data: { ...base, routes }, storedPois, cache };
}
