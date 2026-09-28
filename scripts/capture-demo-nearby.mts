import { readFile, writeFile } from "node:fs/promises";
import { fetchPlaceAround, fetchWalkingRoute } from "../src/map/capabilityClient";
import { mergeBaiduPlaceDetail } from "../src/map/poiAdapter";
import { buildGoalSupplyPolicy, matchingRule, isNavigation, limitCandidatesPerTag } from "../src/recommendation/goalCandidateSupply";
import { parseUserIntent } from "../src/recommendation/intent";
import type { MapPOI, RouteResult } from "../src/contracts/map";
import type { DiscoveredCandidate } from "../src/contracts/discovery";
import { sameEndpoint } from "../src/route-builder/edges";
import { geometry } from "../src/route-builder/math";

const base = JSON.parse(await readFile(new URL("../src/demo/public-capture.json", import.meta.url), "utf8"));
const output = new URL("../src/demo/public-nearby-capture.json", import.meta.url);
type RecordData = { origin: typeof base.origin; capturedAt: string; pools: Record<string, DiscoveredCandidate[]>; routes: RouteResult[];
  searches: Array<{ goal: string; keywords: string[]; radius: number; raw: number; accepted: number }>; requests: { search: number; routes: number } };
let record: RecordData;
try { record = JSON.parse(await readFile(output, "utf8")); }
catch { record = { origin: base.origin, capturedAt: "", pools: {}, routes: [], searches: [], requests: { search: 0, routes: 0 } }; }
if (!sameEndpoint(record.origin, base.origin)) throw new Error("Public origin mismatch");
const mode = process.argv[2];
if (!["--search", "--origins", "--inspect"].includes(mode)) throw new Error("Explicit capture stage required");
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  if (typeof input !== "string" || !(mode === "--search" ? input.startsWith("/api/map/place-around?") : mode === "--origins" && input.startsWith("/api/map/walking-route?"))) throw new Error("Outside capture scope");
  return nativeFetch(`http://127.0.0.1:5173${input}`, init);
};
const save = async () => { record.capturedAt = new Date().toISOString(); await writeFile(output, JSON.stringify(record, null, 2) + "\n"); };
const queries = { rest: ["书咖", "书店", "甜品店", "公园"], walk: ["公园", "商业街", "购物中心", "美术馆"], explore: ["书店", "商业街", "美术馆", "手工制作"] };
if (mode === "--search") for (const activity of ["rest", "walk", "explore"] as const) {
  const policy = buildGoalSupplyPolicy(parseUserIntent({ minutes: 90, activity, text: "", avoidCost: false, nearby: false }));
  if (record.searches.some(s => s.goal === policy.goal)) continue;
  const keywords = queries[activity];
  if (!keywords.every(q => [...policy.s, ...policy.m].some(rule => rule.query === q))) throw new Error("Non S/M keyword");
  record.requests.search++;
  const response = await fetchPlaceAround(base.origin.location, 1500, keywords, 0);
  const candidates: DiscoveredCandidate[] = [];
  for (const detail of response.places) {
    if (!detail.location) continue;
    const poi = mergeBaiduPlaceDetail({ source: "real", provider: "baidu", providerId: detail.providerId, name: detail.name, location: detail.location } as MapPOI,
      { ...detail, observedAt: response.observedAt, expiresAt: response.expiresAt });
    const match = matchingRule(poi.classifiedPoiTag, policy);
    if (!match || isNavigation(poi.classifiedPoiTag)) continue;
    candidates.push({ poi, classifiedPoiTag: poi.classifiedPoiTag, goalMatch: match.level, sourceLayer: match.level === "W" ? "W-natural" : match.level,
      tagValidation: "matched", matchedSearchCategories: [], discoveryPriority: match.level === "S" ? "high" : "medium" });
  }
  record.pools[policy.goal] = limitCandidatesPerTag(candidates);
  record.searches.push({ goal: policy.goal, keywords, radius: 1500, raw: response.rawResultCount, accepted: record.pools[policy.goal].length });
  await save();
}
if (mode === "--origins") {
  const pois = [...new Map(Object.values(record.pools).flat().map(c => [c.poi.providerId, c.poi])).values()]
    .sort((a, b) => geometry([base.origin.location, a.location]).chainMeters - geometry([base.origin.location, b.location]).chainMeters);
  let calls = 0;
  for (const poi of pois) {
    const to = { id: poi.providerId, location: poi.location };
    if ([...base.routes, ...record.routes].some(r => sameEndpoint(r.from, base.origin) && sameEndpoint(r.to, to))) continue;
    if (calls >= 12) break;
    calls++; record.requests.routes++;
    const route = await fetchWalkingRoute({ from: base.origin, to, destinationUid: poi.providerId });
    record.routes.push(route); await save();
    if (route.status !== "success") break;
    await new Promise(resolve => setTimeout(resolve, 400));
  }
}
console.log(JSON.stringify({ requests: record.requests, searches: record.searches,
  pools: Object.fromEntries(Object.entries(record.pools).map(([goal, candidates]) => [goal, candidates.map(c => ({ name: c.poi.name, tag: c.classifiedPoiTag,
    meters: Math.round(geometry([base.origin.location, c.poi.location]).chainMeters),
    route: [...base.routes, ...record.routes].find(r => r.to.id === c.poi.providerId) }))])) }, null, 2));
