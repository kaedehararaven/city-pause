import type { MapLocation, MapPOI, RouteEndpoint } from "./map";
import type { SearchCategory, SearchPolicy, SearchPriority } from "./search";

export type DiscoveryRequest = {
  policy: SearchPolicy;
  center: MapLocation;
};
export type DiscoveredCandidate = {
  discoveryBand?: "near" | "expanded";
  poi: MapPOI;
  matchedSearchCategories: SearchCategory[];
  discoveryPriority: SearchPriority;
  goalMatch?: "S" | "M" | "W";
  sourceLayer?: "S" | "M" | "W-natural";
  classifiedPoiTag?: string;
  tagValidation?: "matched" | "rejected" | "unknown";
  filterReason?: string;
};
export type DiscoveryCategoryResult = {
  failureReasons?: Record<string, number>;
  category: SearchCategory;
  priority: SearchPriority;
  query: string;
  keywords?: string[];
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
  rawResultCount?: number;
  rawResultSetCount?: number;
  adapterInputCount?: number;
  dedupeCount?: number;
  detailSuccessCount?: number;
  classifiedTagAvailableCount?: number;
  tagMatchedCount?: number;
  subplaceFilteredCount?: number;
  matchedClassifiedPoiTags?: string[];
};
export type CandidateDiscoveryResult = {
  observations?: { searchedQueries: number; validCount: number; uniqueCandidates: DiscoveredCandidate[]; sValidCount?: number; mTriggered?: boolean; finalClassifiedPoiTagCount?: number };
  source: "real";
  status: "success" | "partial_success" | "empty" | "error";
  candidates: DiscoveredCandidate[];
  categories: DiscoveryCategoryResult[];
};

export type DiscoverySnapshot = {
  envelope?: { mode: import("./map").TravelMode; availableMinutes: number; radiusMeters: number; heuristic: true; capped: boolean };
  origin: RouteEndpoint & { name: string };
  result: CandidateDiscoveryResult;
  searchedCategories: SearchCategory[];
};
