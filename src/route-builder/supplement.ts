import type { DiscoveredCandidate } from "../contracts/discovery";
import type { MapPOI } from "../contracts/map";
import type { DiscoverySearch } from "../map/discovery";
import { discoveryEnvelope } from "../map/discoveryEnvelope";
import { buildDecisionResult } from "../recommendation/engine";
import { buildGoalSupplyPolicy, isNavigation, limitCandidatesPerTag, matchingRule } from "../recommendation/goalCandidateSupply";
import { createRealCandidateData } from "../recommendation/realProvider";
import { buildMultiStop, type BuildInput } from "./builder";
import { EdgeSession, validEdge } from "./edges";
import { geometry, validLocation } from "./math";
import type { BuildResult } from "./model";
import { DEFAULT_ROUTE_BUDGET, familyFor, maxStops, type Family } from "./policy";
import { goalOrder } from "./ranking";

export type SupplementAudit = {
  triggered: boolean; keywords: string[]; rawCount: number; accepted: number;
  cacheHit: boolean; error?: string; familiesBefore: Family[]; familiesAfter: Family[];
  routeRequests: number; addedFeasible: number; rejected: Record<string, number>;
};
type SupplyEntry = { pois: MapPOI[]; expiresAt: number };
export type SupplementCache = Map<string, SupplyEntry>;
const identity = (poi: MapPOI) => `${poi.provider}:${poi.providerId}`;

// Reclassify facts for this Goal. Keyword/source Goal never supplies a level.
export function validateSupplement(pois: readonly MapPOI[], input: Pick<BuildInput, "intent" | "data">, rejected: Record<string, number> = {}): DiscoveredCandidate[] {
  const policy = buildGoalSupplyPolicy(input.intent), result: DiscoveredCandidate[] = [];
  const seen = new Set<string>();
  const reject = (reason: string) => { rejected[reason] = (rejected[reason] ?? 0) + 1; };
  const accept = (poi: MapPOI) => {
    const key = identity(poi);
    if (seen.has(key)) return;
    seen.add(key);
    if (poi.source !== "real" || poi.provider !== "baidu" || !poi.providerId || !poi.name || !validLocation(poi.location)) { reject("invalid_poi"); return; }
    const match = matchingRule(poi.classifiedPoiTag, policy);
    if (isNavigation(poi.classifiedPoiTag)) reject("navigation_poi");
    else if (!match) reject(poi.classifiedPoiTag ? "not_in_goal_whitelist" : "classified_tag_missing");
    else if (!familyFor(poi)) reject("family_unknown");
    else result.push({ poi, classifiedPoiTag: poi.classifiedPoiTag, tagValidation: "matched", goalMatch: match.level,
      sourceLayer: match.level === "W" ? "W-natural" : match.level, matchedSearchCategories: [], discoveryPriority: match.level === "S" ? "high" : "medium" });
    for (const child of poi.subPlaces ?? []) if (child.location) accept({ source: "real", provider: "baidu", providerId: child.providerId,
      name: child.name, classifiedPoiTag: child.classifiedPoiTag, location: child.location, address: child.address });
  };
  pois.forEach(accept);
  // Capacity is shared with existing candidates, never five extra per tag.
  const base = input.data.discoveredCandidates ?? [];
  const baseIds = new Set(input.data.places.map(identity));
  return limitCandidatesPerTag([...base, ...result]).filter(candidate => !baseIds.has(identity(candidate.poi)));
}

export function supplementKeywords(input: Pick<BuildInput, "intent" | "singles">) {
  const families = new Set(input.singles.flatMap(single => { const family = familyFor(single.places[0]); return family ? [family.family] : []; }));
  if (!maxStops(input.intent) || input.intent.returnMode !== "open_ended" || families.size >= maxStops(input.intent)) return [];
  const policy = buildGoalSupplyPolicy(input.intent);
  return [...new Set([...policy.s, ...policy.m].filter(rule => {
    const family = familyFor({ classifiedPoiTag: rule.path });
    return family && !families.has(family.family);
  }).map(rule => rule.query))];
}

export async function buildMultiWithSupply(input: BuildInput & {
  search?: DiscoverySearch; supplyCache?: SupplementCache; storedPois?: readonly MapPOI[];
}): Promise<BuildResult> {
  const signal = input.signal ?? new AbortController().signal;
  const session = input.session ?? new EdgeSession({ source: input.data.source, budget: input.budget ?? DEFAULT_ROUTE_BUDGET,
    cache: input.cache ?? new Map(), fetchEdge: input.fetchEdge, signal });
  const families = new Set(input.singles.flatMap(single => { const family = familyFor(single.places[0]); return family ? [family.family] : []; }));
  const audit: SupplementAudit = { triggered: false, keywords: [], rawCount: 0, accepted: 0, cacheHit: false,
    familiesBefore: [...families], familiesAfter: [...families], routeRequests: 0, addedFeasible: 0, rejected: {} };
  let data = input.data, singles = input.singles;
  const keywords = supplementKeywords(input);
  if (input.data.source === "real" && (input.data.travelMode ?? "walking") === "walking" && keywords.length) {
    audit.triggered = true; audit.keywords = keywords;
    const policy = buildGoalSupplyPolicy(input.intent);
    const key = JSON.stringify([policy.goal, input.data.origin, discoveryEnvelope(input.intent.availableMinutes).radiusMeters, keywords]);
    const cached = input.supplyCache?.get(key);
    let pois: readonly MapPOI[] = input.storedPois ?? [];
    if (!input.storedPois && cached && cached.expiresAt > Date.now()) { pois = cached.pois; audit.cacheHit = true; }
    else if (!input.storedPois && input.search) {
      try {
        const response = await input.search(keywords, signal);
        signal.throwIfAborted();
        if ("pois" in response) pois = response.pois;
        audit.error = response.errorCode ?? (["timeout", "provider_error"].includes(response.status) ? response.status : undefined);
        if (!audit.error && input.supplyCache) {
          for (const [key, value] of input.supplyCache) if (value.expiresAt <= Date.now()) input.supplyCache.delete(key);
          while (input.supplyCache.size >= 8) input.supplyCache.delete(input.supplyCache.keys().next().value!);
          input.supplyCache.set(key, { pois: [...pois], expiresAt: Date.now() + 5 * 60_000 });
        }
      } catch { signal.throwIfAborted(); audit.error = "supplement_search_unavailable"; }
    }
    audit.rawCount = pois.length;
    const added = validateSupplement(pois, input, audit.rejected);
    audit.accepted = added.length;
    // Free proposal ordering only. Confirmed single-place ranking is reapplied
    // after route validation, and the displayed single-place results are untouched.
    added.sort((a, b) => goalOrder[b.goalMatch!] - goalOrder[a.goalMatch!] ||
      geometry([input.data.origin.location, a.poi.location]).chainMeters - geometry([input.data.origin.location, b.poi.location]).chainMeters ||
      a.poi.providerId.localeCompare(b.poi.providerId));
    const routes = [...input.data.routes], retained: DiscoveredCandidate[] = [];
    for (const candidate of added) {
      signal.throwIfAborted();
      if (families.size >= maxStops(input.intent)) break;
      const family = familyFor(candidate.poi)!.family;
      if (families.has(family)) continue;
      const request = { from: data.origin, to: { id: candidate.poi.providerId, location: candidate.poi.location }, destinationUid: candidate.poi.providerId };
      const known = routes.find(route => validEdge(route, request, "real")) ?? session.peek(request);
      // Up to two missing origin edges, within the same six-call route ledger.
      // Leave at least one request for the actual inter-stop connection.
      if (!known && (audit.routeRequests >= 2 || session.stats.requests >= session.budget - 1)) continue;
      const before = session.stats.requests;
      const outbound = known ?? await session.get(request);
      audit.routeRequests += session.stats.requests - before;
      if (!outbound || outbound.status !== "success") continue;
      const probe = createRealCandidateData({ origin: data.origin, discoveredCandidates: [candidate], routes: [outbound] });
      if (!buildDecisionResult(input.intent, probe).recommendations.length) { audit.rejected.single_feasibility = (audit.rejected.single_feasibility ?? 0) + 1; continue; }
      retained.push(candidate); families.add(family);
      if (!routes.includes(outbound)) routes.push(outbound);
    }
    audit.addedFeasible = retained.length; audit.familiesAfter = [...families];
    if (retained.length) {
      const extra = createRealCandidateData({ origin: data.origin, discoveredCandidates: retained, routes });
      data = { ...data, places: [...data.places, ...extra.places], discoveredCandidates: [...(data.discoveredCandidates ?? []), ...retained], routes };
      singles = buildDecisionResult(input.intent, data).recommendations;
    }
  }
  const result = await buildMultiStop({ ...input, data, singles, session, signal });
  result.audit.supplement = audit;
  return result;
}
