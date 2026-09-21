import type { MapPOI, RouteEndpoint, RouteResult } from "../contracts/map";
import type { DiscoveredCandidate } from "../contracts/discovery";
import { SEARCH_CATEGORIES } from "../contracts/search";
import type { CandidateData, CandidateProvider } from "./model";

export type RealCandidateInput = {
  origin: RouteEndpoint & { name: string };
  poi?: MapPOI;
  pois?: MapPOI[];
  routes: RouteResult[];
  discoveredCandidates?: DiscoveredCandidate[];
};

// Stay time is an A-side generic policy. It is not supplied by Baidu and is not
// specific to parks or any other POI category.
const defaultStayPolicy = {
  minimumStayMinutes: 5,
  suggestedStayMinutes: 15,
  stayAllocation: "flexible",
} as const;

export function createRealCandidateData(input: RealCandidateInput): CandidateData {
  const discovered = input.discoveredCandidates;
  const pois = input.pois ?? (input.poi ? [input.poi] : discovered?.map(candidate => candidate.poi) ?? []);
  if (pois.some(poi => poi.source !== "real" || poi.provider !== "baidu")) {
    throw new Error("Real candidate provider requires a real MapPOI");
  }
  if (discovered) {
    const identity = (poi: MapPOI) => JSON.stringify([poi.provider, poi.providerId]);
    const supplied = new Map(pois.map(poi => [identity(poi), poi]));
    const seen = new Set<string>();
    if (supplied.size !== pois.length || discovered.length !== pois.length) {
      throw new Error("Discovery metadata must match the unique candidate set");
    }
    for (const candidate of discovered) {
      const key = identity(candidate.poi);
      const poi = supplied.get(key);
      if (candidate.poi.source !== "real" || candidate.poi.provider !== "baidu" || !poi || seen.has(key) ||
          candidate.poi.location.latitude !== poi.location.latitude ||
          candidate.poi.location.longitude !== poi.location.longitude ||
          candidate.poi.location.coordinateSystem !== poi.location.coordinateSystem ||
          !candidate.matchedSearchCategories.every(category => SEARCH_CATEGORIES.includes(category)) ||
          !["high", "medium", "low"].includes(candidate.discoveryPriority)) {
        throw new Error("Invalid or inconsistent discovery metadata");
      }
      seen.add(key);
    }
  }

  return {
    source: "real",
    origin: input.origin,
    places: pois.map(poi =>
      ({
        ...poi,
        categoryLabel: poi.categories?.join(" / "),
        // kind and costRequired stay unknown until a separate, explicit rule or
        // trustworthy data source supplies them.
        ...defaultStayPolicy,
      }),
    ),
    routes: input.routes,
    ...(discovered ? { discoveredCandidates: discovered.map(candidate => ({
      ...candidate, matchedSearchCategories: [...new Set(candidate.matchedSearchCategories)],
    })) } : {}),
  };
}

export function createRealCandidateProvider(
  input: RealCandidateInput,
): CandidateProvider {
  return {
    source: "real",
    getCandidateData: () => createRealCandidateData(input),
  };
}
