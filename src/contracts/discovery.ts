import type { MapLocation, MapPOI, RouteEndpoint } from "./map";
import type { SearchCategory, SearchPolicy, SearchPriority } from "./search";

export type DiscoveryRequest = {
  policy: SearchPolicy;
  center: MapLocation;
};
export type DiscoveredCandidate = {
  poi: MapPOI;
  matchedSearchCategories: SearchCategory[];
  discoveryPriority: SearchPriority;
};
export type DiscoveryCategoryResult = {
  category: SearchCategory;
  priority: SearchPriority;
  query: string;
  status: "success" | "empty" | "provider_error" | "timeout";
  totalReported?: number;
  inspectedCount: number;
  validCount: number;
  retainedCount: number;
  duplicateCount: number;
  samples: Array<{
    name: string;
    hasProviderId: boolean;
    hasLocation: boolean;
    hasAddress: boolean;
    providerCategories?: string[];
  }>;
};
export type CandidateDiscoveryResult = {
  source: "real";
  status: "success" | "partial_success" | "empty" | "error";
  candidates: DiscoveredCandidate[];
  categories: DiscoveryCategoryResult[];
};

export type DiscoverySnapshot = {
  origin: RouteEndpoint & { name: string };
  result: CandidateDiscoveryResult;
  searchedCategories: SearchCategory[];
};
