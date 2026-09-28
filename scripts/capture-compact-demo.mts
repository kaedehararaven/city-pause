import { readFile, writeFile } from "node:fs/promises";
import { replayCapture } from "../src/demo/replayData";
import { fetchWalkingRoute } from "../src/map/capabilityClient";
import { familyFor } from "../src/route-builder/policy";
import { geometry } from "../src/route-builder/math";
import { edgeKey, sameEndpoint, validEdge, type EdgeCache, type EdgeRequest } from "../src/route-builder/edges";
import { buildMultiWithSupply } from "../src/route-builder/supplement";
import { parseUserIntent } from "../src/recommendation/intent";
import { createRealCandidateData } from "../src/recommendation/realProvider";
import { buildDecisionResult } from "../src/recommendation/engine";
import type { RouteResult } from "../src/contracts/map";

const history = JSON.parse(await readFile(new URL("../src/demo/public-multi-capture.json", import.meta.url), "utf8"));
const wangfujing = process.argv.includes("--wangfujing");
if (wangfujing) {
  const previous = JSON.parse(await readFile(new URL("../src/demo/public-compact-capture.json", import.meta.url), "utf8"));
  history.edges.push(...previous.edges);
}
const pois = [...new Map(Object.values(replayCapture.pools).flat().map(c => [c.poi.providerId, c.poi])).values()];
const place = pois.find(p => p.providerId === (wangfujing ? "4577566104531adfcb213d76" : "9650da9e8e88aa222cb17ee1"))!;
if (!place) throw new Error("Public origin not found");
const origin = { id: place.providerId, name: `${place.name}周边（公开演示起点）`, location: place.location };
const output = new URL(wangfujing ? "../src/demo/public-wangfujing-capture.json" : "../src/demo/public-compact-capture.json", import.meta.url);
let record: { origin: typeof origin; capturedAt: string; edges: RouteResult[]; requests: number };
try { record = JSON.parse(await readFile(output, "utf8")); }
catch { record = { origin, capturedAt: "", edges: [], requests: 0 }; }
const acquire = process.argv.includes("--capture");
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (!acquire || typeof input !== "string" || !input.startsWith("/api/map/walking-route?")) throw new Error("Capture scope violation");
  return nativeFetch(`http://127.0.0.1:5173${input}`, init);
};
const cache: EdgeCache = new Map();
for (const edge of [...history.edges, ...record.edges]) {
  const request = { from: edge.from, to: edge.to, destinationUid: edge.to.id };
  if (validEdge(edge, request, "real")) cache.set(edgeKey(request), { route: edge, expiresAt: Infinity });
}
let calls = 0, failures = 0;
const fetchEdge = async (request: EdgeRequest) => {
  const cached = cache.get(edgeKey(request)); if (cached) return cached.route;
  if (!acquire || calls >= 18 || failures >= 2 || ![request.from, request.to].every(e => pois.some(p => sameEndpoint(e, { id: p.providerId, location: p.location })))) throw new Error("Capture budget/endpoints");
  calls++; record.requests++;
  const route = await fetchWalkingRoute(request);
  if (route.status !== "success") failures++;
  record.edges.push(route); record.capturedAt = new Date().toISOString();
  await writeFile(output, JSON.stringify(record, null, 2) + "\n");
  if (validEdge(route, request, "real")) cache.set(edgeKey(request), { route, expiresAt: Infinity });
  await new Promise(resolve => setTimeout(resolve, 400));
  return route;
};
// Only six short, complementary public-origin edges; no place search/detail.
const counts = new Map<string, number>();
for (const poi of [...pois].sort((a,b) => geometry([origin.location,a.location]).chainMeters - geometry([origin.location,b.location]).chainMeters)) {
  const family = familyFor(poi)?.family;
  if (!family || !["food", "interest", "green"].includes(family) || (counts.get(family) ?? 0) >= 2) continue;
  counts.set(family, (counts.get(family) ?? 0) + 1);
  if (acquire) await fetchEdge({ from: origin, to: { id: poi.providerId, location: poi.location }, destinationUid: poi.providerId });
}
for (const minutes of [90,120,150,180]) for (const activity of ["rest","walk","explore"] as const) {
  const intent = parseUserIntent({ minutes, activity, text: "", avoidCost: false, nearby: false });
  const goal = activity === "explore" ? "discover" : activity;
  const routes = [...history.edges, ...record.edges];
  const data = createRealCandidateData({ origin, discoveredCandidates: replayCapture.pools[goal].filter(c => c.poi.providerId !== origin.id), routes });
  const result = await buildMultiWithSupply({ intent, data, singles: buildDecisionResult(intent,data).recommendations, storedPois: pois.filter(p=>p.providerId!==origin.id), cache,
    ...(acquire && calls < 18 ? { fetchEdge } : {}) });
  console.log(JSON.stringify({minutes,activity,status:result.status,count:result.routes.length, missing:result.audit.missingEdges}));
}
console.log(JSON.stringify({newRequests:calls,totalRequests:record.requests}));
