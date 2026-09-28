import { readFile, writeFile } from "node:fs/promises";
import type { MapPOI, RouteEndpoint, RouteResult } from "../src/contracts/map";
import type { DiscoveredCandidate } from "../src/contracts/discovery";
import { parseUserIntent } from "../src/recommendation/intent";
import { buildDecisionResult } from "../src/recommendation/engine";
import { createRealCandidateData } from "../src/recommendation/realProvider";
import { limitCandidatesPerTag } from "../src/recommendation/goalCandidateSupply";
import { buildMultiWithSupply } from "../src/route-builder/supplement";
import { edgeKey, sameEndpoint, validEdge, type EdgeCache, type EdgeRequest } from "../src/route-builder/edges";
import { fetchWalkingRoute } from "../src/map/capabilityClient";
import { replayCapture } from "../src/demo/replayData";

const base = replayCapture as {
  origin: RouteEndpoint & { name: string }; pools: Record<string, DiscoveredCandidate[]>; routes: RouteResult[];
};
const output = new URL("../src/demo/public-multi-capture.json", import.meta.url);
const previous = JSON.parse(await readFile(output, "utf8")) as {
  version: string; capturedAt: string | null; origin: RouteEndpoint | null; pois: MapPOI[]; edges: RouteResult[]; requests: { search: number; routes: number };
};
const record = previous.origin && sameEndpoint(previous.origin, base.origin) ? previous : {
  version: "multi-stop-v1", capturedAt: null, origin: base.origin, pois: [], edges: [], requests: { search: 0, routes: 0 },
};
const storedPois = [...Object.values(base.pools).flat().map(candidate => candidate.poi), ...record.pois];
const allowed = [base.origin, ...storedPois.map(poi => ({ id: poi.providerId, location: poi.location }))];
const acquire = process.argv.includes("--capture");
if (!acquire && !process.argv.includes("--plan")) throw new Error("Use --plan (offline) or --capture (public routes only)");
const nativeFetch = globalThis.fetch;
// Only the fixed existing server route. No search, detail, geolocation or AK access.
globalThis.fetch = (input, init) => {
  if (!acquire || typeof input !== "string" || !input.startsWith("/api/map/walking-route?")) throw new Error("Request outside capture scope");
  return nativeFetch(`http://127.0.0.1:5173${input}`, init);
};
let calls = 0, consecutiveFailures = 0;
const fetchEdge = async (request: EdgeRequest): Promise<RouteResult> => {
  if (!allowed.some(p => sameEndpoint(p, request.from)) || !allowed.some(p => sameEndpoint(p, request.to))) throw new Error("Non-public endpoint rejected");
  if (calls >= 18 || consecutiveFailures >= 3) throw new Error("Public capture budget/service stop");
  calls++; record.requests.routes++;
  await new Promise(resolve => setTimeout(resolve, 450));
  const route = await fetchWalkingRoute(request);
  if (route.status === "timeout" || route.status === "provider_error") consecutiveFailures++; else consecutiveFailures = 0;
  const index = record.edges.findIndex(edge => sameEndpoint(edge.from, request.from) && sameEndpoint(edge.to, request.to));
  if (index >= 0) record.edges[index] = route; else record.edges.push(route);
  record.capturedAt = new Date().toISOString();
  // Checkpoint adapted public facts after every edge; never raw API responses.
  await writeFile(output, JSON.stringify(record, null, 2) + "\n");
  return route;
};
for (const minutes of [90, 120, 150, 180]) for (const activity of ["rest", "walk", "explore"] as const) {
  if (consecutiveFailures >= 3 || calls >= 18) break;
  const goal = activity === "explore" ? "discover" : activity;
  const intent = parseUserIntent({ minutes, activity, text: "", avoidCost: false, nearby: false });
  const data = createRealCandidateData({ origin: base.origin, discoveredCandidates: limitCandidatesPerTag(base.pools[goal]), routes: base.routes });
  const cache: EdgeCache = new Map();
  for (const edge of record.edges) {
    const request = { from: edge.from, to: edge.to, destinationUid: edge.to.id };
    if (validEdge(edge, request, "real")) cache.set(edgeKey(request), { route: edge, expiresAt: Infinity });
  }
  const result = await buildMultiWithSupply({ intent, data, singles: buildDecisionResult(intent, data).recommendations,
    storedPois, cache, ...(acquire ? { fetchEdge } : {}) });
  console.log(JSON.stringify({ minutes, goal, status: result.status, routes: result.routes.length, requests: result.audit.requests,
    families: result.audit.familyCounts, supplement: result.audit.supplement, anchors: result.audit.anchorAttempts,
    stopCounts: result.routes.map(route => route.stops.length) }));
}
console.log(JSON.stringify({ publicOnly: true, searchRequests: 0, realRouteRequests: calls,
  storedSuccessfulEdges: record.edges.filter(edge => edge.status === "success").length, mode: acquire ? "capture" : "offline-plan" }));
