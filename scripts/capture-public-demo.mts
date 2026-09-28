import { readFile, writeFile, mkdir } from "node:fs/promises";
import { buildGoalSupplyPolicy, discoverGoalCandidates } from "../src/recommendation/goalCandidateSupply";
import { parseUserIntent } from "../src/recommendation/intent";
import { createWebPlaceSearch } from "../src/map/webPlaceSearch";
import { fetchBatchPlaceDetails, fetchWalkingRoute } from "../src/map/capabilityClient";
import type { DiscoveredCandidate } from "../src/contracts/discovery";

// Only the fixed public development area; never reads user geolocation or AK.
const source = await readFile(new URL("../src/map/BaiduMap.tsx", import.meta.url), "utf8");
const block = source.match(/const developmentCenter = \{([\s\S]*?)\}/)![1];
const location = { latitude: Number(block.match(/latitude:\s*([\d.]+)/)![1]), longitude: Number(block.match(/longitude:\s*([\d.]+)/)![1]), coordinateSystem: "BD-09" as const };
const origin = { id: "public-demo-origin", name: "公开测试起点", location };
const nativeFetch = globalThis.fetch;
globalThis.fetch = (input, init) => nativeFetch(typeof input === "string" && input.startsWith("/") ? `http://127.0.0.1:5173${input}` : input, init);
const signal = new AbortController().signal;
const rest = parseUserIntent({ minutes: 60, activity: "rest", text: "", avoidCost: false, nearby: false });
if (process.argv.includes("--probe")) {
  const response = await createWebPlaceSearch(location, 3000)(buildGoalSupplyPolicy(rest).s.map(r => r.query), signal);
  if (!("pois" in response)) { console.log(JSON.stringify({ status: response.status })); process.exitCode = 1; }
  else {
    const fields = ["classifiedPoiTag", "rating", "priceText", "openingHours", "brand", "parentProviderId", "navigationLocation"] as const;
    console.log(JSON.stringify({ status: response.status, count: response.pois.length, coverage: Object.fromEntries(fields.map(field => [field, response.pois.filter(poi => poi[field] !== undefined).length])) }));
  }
} else if (process.argv.includes("--capture")) {
  const pools: Record<string, DiscoveredCandidate[]> = {};
  const reports: Record<string, unknown> = {};
  let searches = 0, batches = 0;
  const seen = new Map<string, DiscoveredCandidate>();
  for (const activity of ["rest", "walk", "explore"] as const) {
    const policy = buildGoalSupplyPolicy(parseUserIntent({ minutes: 60, activity, text: "", avoidCost: false, nearby: false }));
    const search = createWebPlaceSearch(location, 3000);
    const result = await discoverGoalCandidates({ origin, policy, signal,
      search: async (query, signal) => { if (++searches > 6) throw new Error("Search budget reached"); return search(query, signal); },
      loadDetail: async () => { throw new Error("Single detail disabled for capture"); },
      loadDetails: async pois => { batches++; return fetchBatchPlaceDetails(pois); },
    });
    if (result.serviceError) throw new Error(`Capture stopped: ${result.serviceError}`);
    pools[policy.goal] = result.candidates;
    reports[policy.goal] = { count: result.candidates.length, tags: result.finalClassifiedPoiTagCount, s: result.sCount, m: result.mTriggered };
    for (const candidate of result.candidates) seen.set(candidate.poi.providerId, candidate);
    console.log(JSON.stringify({ goal: policy.goal, ...reports[policy.goal] as object }));
  }
  if (seen.size > 80) throw new Error("Route acquisition budget exceeded; no routes requested");
  const routes = [];
  let failures = 0;
  for (const candidate of seen.values()) {
    await new Promise(resolve => setTimeout(resolve, 450));
    const route = await fetchWalkingRoute({ from: origin, to: { id: candidate.poi.providerId, location: candidate.poi.location }, destinationUid: candidate.poi.providerId });
    routes.push(route);
    if (route.status === "provider_error" || route.status === "timeout") {
      if (++failures >= 3) throw new Error("Route provider unavailable; acquisition stopped");
    } else failures = 0;
  }
  // Public-area data only. Store adapted contracts, never credentials/raw responses.
  const record = { version: "goal-v3-search", capturedAt: new Date().toISOString(), region: "公开测试区域", origin, pools, routes, reports, requests: { searches, batches, routes: routes.length } };
  await mkdir(new URL("../src/demo/", import.meta.url), { recursive: true });
  await writeFile(new URL("../src/demo/public-capture.json", import.meta.url), JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ saved: true, uniqueCandidates: seen.size, successfulRoutes: routes.filter(r => r.status === "success").length, requests: record.requests }));
} else throw new Error("Use --probe or --capture explicitly");
