import type { RouteEndpoint, SuccessfulRouteResult } from "../contracts/map";
import type { CandidatePlace, PlanStep } from "../recommendation/model";
import type { GoalMatch } from "../recommendation/goalCandidateSupply";
import type { DwellRange, Family } from "./policy";

export type RouteCandidate = {
  poi: CandidatePlace;
  endpoint: RouteEndpoint;
  rank: number;
  goalMatch: GoalMatch;
  family: Family;
  familyLabel: string;
  range: DwellRange;
  outbound: SuccessfulRouteResult;
};
export type MultiRoute = {
  id: string;
  title: string;
  source: "real" | "mock";
  originName: string;
  stops: RouteCandidate[];
  edges: SuccessfulRouteResult[];
  travelSeconds: number;
  exactDwell: number[];
  displayDwell: number[];
  bufferMinutes: number;
  exactTotalMinutes: number;
  totalMinutes: number;
  remainingMinutes: number;
  unusedAfterDwellMaxMinutes: number;
  displayRoundingMinutes: number;
  steps: PlanStep[];
  geometry: number | null;
  weakestGoal: GoalMatch;
  strongProportion: number;
  minRating: number | null;
  meanMerchantPrice: number | null;
};
export type BuildStatus = "ok" | "not_applicable" | "unsupported_mode" | "no_feasible_multi_stop" | "missing_candidate_facts" | "missing_offline_edges" | "provider_unavailable" | "search_incomplete" | "no_route_for_anchor";
export type BuildResult = {
  status: BuildStatus;
  routes: MultiRoute[];
  audit: {
    demoSelection?: { preset: string; algorithmRouteCount: number; displayedRouteCount: number; historicalDessertValidated: boolean };
    supplement?: import("./supplement").SupplementAudit;
    budget: number; requests: number; cacheHits: number; missingEdges: number;
    failures: number; noRoutes: number; budgetDenied: number; truncated: number;
    anchorAttempts: { rank: number; potentialPartners: number; scanned: number; requests?: number; outcome?: string }[];
    candidates: number; skippedCandidates: number; verifiedPairs: number; verifiedTriples: number;
    maxStops: 0 | 2 | 3; unusedRequestBudget: number;
    familyCounts: Partial<Record<Family, number>>;
    skippedReasons: Record<string, number>;
    precheckRejections: Record<string, number>; routeRejections: Record<string, number>;
    secondProposalsChecked: number; thirdProposalsChecked: number;
    reallocatedSecondRequests: number; removedPairs: number; removedTriples: number;
  };
};
