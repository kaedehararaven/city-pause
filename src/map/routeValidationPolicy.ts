import type { DiscoveredCandidate, DiscoverySnapshot } from "../contracts/discovery";
import type { UserIntent } from "../recommendation/model";

// Technical pacing remains because the provider has a request concurrency
// limit. It is not a recommendation quota or category preference.
export const ROUTE_VALIDATION_BUDGET = { requestIntervalMs: 400 } as const;
export function routeValidationBudget(_intent: UserIntent, enabledModes = 1) {
  return { candidateLimit: Number.POSITIVE_INFINITY, maxRequestsPerMode: Number.POSITIVE_INFINITY, maxRequestsTotal: Number.POSITIVE_INFINITY * enabledModes };
}

export function selectRouteCandidates(_intent: UserIntent, snapshot: DiscoverySnapshot, _legacyLimit?: number): DiscoveredCandidate[] {
  const unique = new Map<string, DiscoveredCandidate>();
  for (const candidate of [...snapshot.result.candidates, ...(snapshot.result.observations?.uniqueCandidates ?? [])]) {
    const key = JSON.stringify([candidate.poi.provider, candidate.poi.providerId]);
    const previous = unique.get(key);
    unique.set(key, previous ? { ...previous, matchedSearchCategories: [...new Set([...previous.matchedSearchCategories, ...candidate.matchedSearchCategories])] } : candidate);
  }
  return [...unique.values()].sort((a, b) => a.poi.providerId.localeCompare(b.poi.providerId));
}
