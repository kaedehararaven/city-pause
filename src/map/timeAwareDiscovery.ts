import type { DiscoverySnapshot, DiscoveryCategoryResult } from "../contracts/discovery";
import type { TravelMode } from "../contracts/map";
import type { SearchPolicy } from "../contracts/search";
import { discoverCandidates } from "./discovery";
import { discoveryEnvelope } from "./discoveryEnvelope";
import { createBaiduDiscoverySearch } from "./localSearchDiscovery";

// Keep a near-area stratum as the envelope grows; the outer stratum adds supply.
export async function discoverTimeAware(api: typeof BMap, origin: DiscoverySnapshot["origin"], policy: SearchPolicy,
  mode: TravelMode, signal: AbortSignal): Promise<DiscoverySnapshot> {
  const envelope = discoveryEnvelope(policy.availableMinutes, mode);
  const inner = Math.min(envelope.radiusMeters, discoveryEnvelope(15, mode).radiusMeters);
  const base = await discoverCandidates({ center: origin.location, policy }, createBaiduDiscoverySearch(api, origin.location, inner), signal);
  base.candidates.forEach(candidate => { candidate.discoveryBand = "near"; });
  base.observations?.uniqueCandidates.forEach(candidate => { candidate.discoveryBand = "near"; });
  if (inner === envelope.radiusMeters || !policy.entries.length) return { origin, result: base, searchedCategories: base.categories.map(c => c.category), envelope };
  signal.throwIfAborted();
  await new Promise(resolve => setTimeout(resolve, 400));
  signal.throwIfAborted();
  const outer = await discoverCandidates({ center: origin.location, policy }, createBaiduDiscoverySearch(api, origin.location, envelope.radiusMeters), signal);
  const combined = new Map(base.candidates.map(c => [JSON.stringify([c.poi.provider, c.poi.providerId]), c]));
  for (const candidate of outer.candidates) {
    const key = JSON.stringify([candidate.poi.provider, candidate.poi.providerId]);
    const previous = combined.get(key);
    if (previous) previous.matchedSearchCategories = [...new Set([...previous.matchedSearchCategories, ...candidate.matchedSearchCategories])];
    else combined.set(key, { ...candidate, discoveryBand: "expanded" });
  }
  const candidates = [...combined.values()].filter((candidate, _index, all) =>
    candidate.matchedSearchCategories.every(category => all.filter(item => item.matchedSearchCategories.includes(category) && item.poi.providerId.localeCompare(candidate.poi.providerId) <= 0).length <= 4));
  const observed = new Map<string, (typeof candidates)[number]>();
  for (const candidate of [...(base.observations?.uniqueCandidates ?? base.candidates), ...(outer.observations?.uniqueCandidates ?? outer.candidates)]) {
    const key = JSON.stringify([candidate.poi.provider, candidate.poi.providerId]);
    const previous = observed.get(key);
    observed.set(key, previous ? { ...previous, matchedSearchCategories: [...new Set([...previous.matchedSearchCategories, ...candidate.matchedSearchCategories])] } :
      { ...candidate, discoveryBand: candidate.discoveryBand ?? "expanded" });
  }
  const failed = [base, outer].some(result => result.status === "error" || result.status === "partial_success");
  const categories: DiscoveryCategoryResult[] = outer.categories.map(report => {
    const near = base.categories.find(c => c.category === report.category);
    if (!near) return report;
    return { ...report,
      // Counts refer to observations across the two queries, not globally unique provider matches.
      totalReported: undefined,
      inspectedCount: near.inspectedCount + report.inspectedCount,
      validCount: near.validCount + report.validCount,
      retainedCount: candidates.filter(c => c.matchedSearchCategories.includes(report.category)).length,
      duplicateCount: near.duplicateCount + report.duplicateCount,
      samples: [...near.samples, ...report.samples],
    };
  });
  return { origin, envelope, searchedCategories: [...new Set([...base.categories, ...outer.categories].map(c => c.category))],
    result: { source: "real", candidates, categories,
      observations: { searchedQueries: base.categories.length + outer.categories.length,
        validCount: (base.observations?.validCount ?? 0) + (outer.observations?.validCount ?? 0), uniqueCandidates: [...observed.values()] },
      status: failed ? base.status === "error" && outer.status === "error" ? "error" : "partial_success" : candidates.length ? "success" : "empty" } };
}
