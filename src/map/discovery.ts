import type { CandidateDiscoveryResult, DiscoveryCategoryResult, DiscoveryRequest } from "../contracts/discovery";
import type { MapPOI } from "../contracts/map";
import { SEARCH_CATEGORIES } from "../contracts/search";
import { baiduQueryFor, DISCOVERY_LIMITS, PRIORITY_ORDER } from "./searchMapping";

export type DiscoveryQueryResult =
  | { status: "success" | "empty"; pois: MapPOI[]; totalReported: number; inspectedCount: number }
  | { status: "provider_error" | "timeout" };
export type DiscoverySearch = (query: string, signal: AbortSignal) => Promise<DiscoveryQueryResult>;

export function validDiscoveryCenter(center: DiscoveryRequest["center"]) {
  return center.coordinateSystem === "BD-09" &&
    Number.isFinite(center.latitude) && Math.abs(center.latitude) <= 90 &&
    Number.isFinite(center.longitude) && Math.abs(center.longitude) <= 180;
}

export async function discoverCandidates(
  request: DiscoveryRequest,
  search: DiscoverySearch,
  signal: AbortSignal = new AbortController().signal,
): Promise<CandidateDiscoveryResult> {
  const { policy, center } = request;
  if (!validDiscoveryCenter(center) || policy.version !== "0.1" ||
      !Number.isInteger(policy.availableMinutes) || policy.availableMinutes < 5 || policy.availableMinutes > 180 ||
      !Array.isArray(policy.entries) || policy.entries.length > SEARCH_CATEGORIES.length ||
      new Set(policy.entries.map(entry => entry.category)).size !== policy.entries.length ||
      policy.entries.some(entry => !baiduQueryFor(entry.category) || !Object.hasOwn(PRIORITY_ORDER, entry.priority))) {
    throw new RangeError("Invalid discovery request");
  }
  const result: CandidateDiscoveryResult = { source: "real", status: "empty", candidates: [], categories: [] };
  const identities = new Map<string, CandidateDiscoveryResult["candidates"][number]>();
  const categoryCandidates: Array<{
    report: DiscoveryCategoryResult;
    identities: string[];
  }> = [];
  const entries = [...policy.entries].sort((a, b) =>
    PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
    SEARCH_CATEGORIES.indexOf(a.category) - SEARCH_CATEGORIES.indexOf(b.category));

  for (const entry of entries) {
    signal.throwIfAborted();
    const query = baiduQueryFor(entry.category)!;
    let response: DiscoveryQueryResult;
    try {
      response = await search(query, signal);
    } catch {
      signal.throwIfAborted();
      response = { status: "provider_error" };
    }
    signal.throwIfAborted();
    const report: DiscoveryCategoryResult = {
      category: entry.category, priority: entry.priority, query, status: response.status,
      inspectedCount: 0, validCount: 0, retainedCount: 0, duplicateCount: 0, samples: [],
    };
    result.categories.push(report);
    if (!("pois" in response)) continue;
    report.totalReported = response.totalReported;
    report.inspectedCount = response.inspectedCount;
    const valid = response.pois.slice(0, DISCOVERY_LIMITS.queryPageSize).filter(poi =>
      poi.source === "real" && poi.provider === "baidu" &&
      typeof poi.providerId === "string" && !!poi.providerId.trim() &&
      typeof poi.name === "string" && !!poi.name.trim() && validDiscoveryCenter(poi.location));
    report.validCount = valid.length;
    report.samples = valid.map(poi => ({
      name: poi.name, hasProviderId: true, hasLocation: true,
      hasAddress: !!poi.address, providerCategories: poi.categories,
    }));
    if (!valid.length && response.inspectedCount > 0) report.status = "provider_error";
    const seen = new Set<string>();
    const available: string[] = [];
    categoryCandidates.push({ report, identities: available });
    for (const poi of valid) {
      const identity = JSON.stringify([poi.provider, poi.providerId]);
      if (seen.has(identity)) { report.duplicateCount++; continue; }
      seen.add(identity);
      available.push(identity);
      const existing = identities.get(identity);
      if (existing) {
        // Preserve observed discovery provenance even after the pool is full.
        report.duplicateCount++;
        if (!existing.matchedSearchCategories.includes(entry.category)) existing.matchedSearchCategories.push(entry.category);
        continue;
      }
      const candidate = { poi, matchedSearchCategories: [entry.category], discoveryPriority: entry.priority };
      identities.set(identity, candidate);
    }
  }
  // Round-robin within deterministic priority order avoids starving later categories.
  const selected = new Set<string>();
  for (let round = 0; round < DISCOVERY_LIMITS.categorySize.high; round++) {
    for (const category of categoryCandidates) {
      if (round >= DISCOVERY_LIMITS.categorySize[category.report.priority] ||
          result.candidates.length >= DISCOVERY_LIMITS.poolSize) continue;
      const identity = category.identities.find(key => !selected.has(key));
      if (!identity) continue;
      selected.add(identity);
      result.candidates.push(identities.get(identity)!);
      category.report.retainedCount++;
    }
  }
  const failures = result.categories.filter(category => category.status === "provider_error" || category.status === "timeout").length;
  result.status = failures === result.categories.length && failures > 0 ? "error" :
    failures > 0 ? "partial_success" : result.candidates.length ? "success" : "empty";
  return result;
}
