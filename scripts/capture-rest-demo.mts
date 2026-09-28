import { readFile, writeFile } from "node:fs/promises";
import { fetchPlaceAround, fetchWalkingRoute } from "../src/map/capabilityClient";
import { mergeBaiduPlaceDetail } from "../src/map/poiAdapter";
import { buildGoalSupplyPolicy, matchingRule, isNavigation, limitCandidatesPerTag } from "../src/recommendation/goalCandidateSupply";
import { parseUserIntent } from "../src/recommendation/intent";
import type { DiscoveredCandidate } from "../src/contracts/discovery";
import type { RouteResult } from "../src/contracts/map";
import { sameEndpoint, type EdgeRequest } from "../src/route-builder/edges";
import { buildDecisionResult } from "../src/recommendation/engine";
import { buildMultiWithSupply } from "../src/route-builder/supplement";

const publicRecord = JSON.parse(await readFile(new URL("../src/demo/public-wangfujing-capture.json", import.meta.url), "utf8"));
const origin = publicRecord.origin;
const output = new URL("../src/demo/public-rest-capture.json", import.meta.url);
let record: { origin: typeof origin; capturedAt: string; candidates: DiscoveredCandidate[]; edges: RouteResult[]; requests: { search: number; routes: number }; query: string[]; radius: number };
try { record = JSON.parse(await readFile(output, "utf8")); }
catch { record = { origin, capturedAt: "", candidates: [], edges: [], requests: { search: 0, routes: 0 }, query: ["咖啡厅", "书咖", "茶馆"], radius: 600 }; }
if (!sameEndpoint(origin, record.origin)) throw new Error("Public origin mismatch");
const mode = process.argv[2];
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input !== "string" || !(mode === "--search" ? input.startsWith("/api/map/place-around?") : ["--origins", "--routes"].includes(mode) && input.startsWith("/api/map/walking-route?"))) throw new Error("Outside capture scope");
  return nativeFetch(`http://127.0.0.1:5173${input}`, init);
};
const save = async () => { record.capturedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(record, null, 2) + "\n"); };
if (mode === "--search" && record.requests.search === 0) {
  const policy = buildGoalSupplyPolicy(parseUserIntent({ minutes: 180, activity: "rest", text: "", avoidCost: false, nearby: false }));
  record.requests.search++;
  const result = await fetchPlaceAround(origin.location, record.radius, record.query, 0);
  for (const detail of result.places) {
    if (!detail.location) continue;
    const poi = mergeBaiduPlaceDetail({ source: "real", provider: "baidu", providerId: detail.providerId, name: detail.name, location: detail.location },
      { ...detail, observedAt: result.observedAt, expiresAt: result.expiresAt });
    const match = matchingRule(poi.classifiedPoiTag, policy);
    if (!match || isNavigation(poi.classifiedPoiTag)) continue;
    record.candidates.push({ poi, classifiedPoiTag: poi.classifiedPoiTag, goalMatch: match.level, sourceLayer: match.level === "W" ? "W-natural" : match.level,
      tagValidation: "matched", matchedSearchCategories: [], discoveryPriority: match.level === "S" ? "high" : "medium" });
  }
  record.candidates = limitCandidatesPerTag(record.candidates);
  await save();
}
if (mode === "--origins") {
  let calls = 0;
  for (const { poi } of record.candidates) {
    const to = { id: poi.providerId, location: poi.location };
    if (record.edges.some(e => sameEndpoint(e.from, origin) && sameEndpoint(e.to, to))) continue;
    if (calls >= 5) break;
    calls++; record.requests.routes++;
    const route = await fetchWalkingRoute({ from: origin, to, destinationUid: poi.providerId });
    record.edges.push(route); await save();
    if (route.status !== "success") break;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}
if (mode === "--routes" || mode === "--plan") {
  const { replayData } = await import("../src/demo/replayData");
  const { replayMultiData } = await import("../src/demo/multiReplay");
  let calls = 0, failed = false;
  const cache = replayMultiData(parseUserIntent({ minutes: 180, activity: "rest", text: "", avoidCost: false, nearby: false })).cache;
  for (const minutes of [180, 90, 120, 150]) {
    const intent = parseUserIntent({ minutes, activity: "rest", text: "", avoidCost: false, nearby: false });
    const context = replayMultiData(intent);
    const allowed = [origin, ...context.storedPois.map(p => ({ id: p.providerId, location: p.location }))];
    const fetchEdge = async (request: EdgeRequest) => {
      if (calls >= 6 || failed || ![request.from,request.to].every(e=>allowed.some(p=>sameEndpoint(e,p)))) throw new Error("Route capture budget or endpoint");
      calls++; record.requests.routes++;
      const route = await fetchWalkingRoute(request);
      record.edges.push(route); await save();
      if (route.status !== "success") failed = true;
      await new Promise(resolve => setTimeout(resolve, 400));
      return route;
    };
    const result = await buildMultiWithSupply({ intent, singles: buildDecisionResult(intent,replayData(intent)).recommendations, ...context, cache,
      ...(mode === "--routes" && calls < 6 && !failed ? { fetchEdge } : {}) });
    console.log(JSON.stringify({ minutes, status: result.status, routes: result.routes.map(r=>({ places:r.stops.map(s=>s.poi.name), tags:r.stops.map(s=>s.poi.classifiedPoiTag), dwell:r.displayDwell, remaining:r.remainingMinutes })), newRequests:calls }));
  }
}
console.log(JSON.stringify({ requests: record.requests, candidates: record.candidates.map(c => ({ name: c.poi.name, tag: c.classifiedPoiTag })) }));
