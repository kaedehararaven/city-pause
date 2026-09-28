import type { CandidateData, CandidatePlace } from "./model";

// Discovery directions, not evidence of free admission, public ownership or seats.
export const NO_SPEND_DISCOVERY_CATEGORIES = ["park", "mall", "bookstore"] as const;

export function isUnverifiedNoSpendAlternative(place: CandidatePlace, data: CandidateData): boolean {
  if (place.costRequired !== undefined || data.source !== "real" || place.source !== "real") return false;
  return data.discoveredCandidates?.some(candidate =>
    candidate.poi.provider === place.provider && candidate.poi.providerId === place.providerId &&
    candidate.poi.source === "real" &&
    candidate.poi.location.latitude === place.location.latitude &&
    candidate.poi.location.longitude === place.location.longitude &&
    candidate.poi.location.coordinateSystem === place.location.coordinateSystem &&
    candidate.matchedSearchCategories.some(category => NO_SPEND_DISCOVERY_CATEGORIES.some(allowed => allowed === category))) ?? false;
}
