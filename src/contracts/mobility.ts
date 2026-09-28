import type { TravelMode } from "./map";

export type TimeBudget = { availableMinutes: number; returnMode: "open_ended" | "return_to_start" };
export function idealTravelLimitSeconds(input: TimeBudget): number {
  return input.availableMinutes * 60 / (input.returnMode === "return_to_start" ? 3 : 4);
}
export function travelLimitSeconds(input: TimeBudget): number {
  return idealTravelLimitSeconds(input) * 1.2;
}
export function passesTravelGate(input: TimeBudget, outboundSeconds: number, returnSeconds?: number): boolean {
  if (!Number.isFinite(outboundSeconds) || outboundSeconds < 0) return false;
  if (input.returnMode === "return_to_start" && (returnSeconds === undefined || !Number.isFinite(returnSeconds) || returnSeconds < 0)) return false;
  return outboundSeconds + (input.returnMode === "return_to_start" ? returnSeconds! : 0) <= travelLimitSeconds(input);
}
export type RoutePreparationAudit = {
  funnel?: CandidateFunnel;
  discovered: number;
  travelMode: TravelMode;
  candidateLimit: number;
  prepared: number;
  requested: number;
  cached: number;
  successful: number;
  failed: Record<"no_route" | "timeout" | "provider_error", number>;
};

export type FunnelCounts = {
  discovered: number; routeSelected: number; routeSuccess: number;
  travelGatePass: number; hardFeasible: number; deliveredPrimary: number;
};
export type CandidateFunnel = {
  travelMode: TravelMode;
  availableMinutes: number;
  returnMode: TimeBudget["returnMode"];
  travelLimitSeconds: number;
  goal: string;
  searchedQueries: number;
  searchStatus: import("./discovery").CandidateDiscoveryResult["status"];
  failedSearchCategories: import("./search").SearchCategory[];
  discoveredObservations: number | null;
  // Exact unique union of inspected valid observations when available, not provider total matches.
  deduped: number | null;
  retained: number;
  counts: FunnelCounts;
  byCategory: Partial<Record<import("./search").SearchCategory, FunnelCounts>>;
  parkOutcome: "NO_PARK_DISCOVERED" | "PARK_NOT_ROUTE_SELECTED" | "PARK_ROUTE_FAILED" |
    "PARK_OVER_TRAVEL_BUDGET" | "PARK_HARD_INFEASIBLE" | "PARK_DELIVERED_TO_A";
  // No coordinates, provider payloads or POI identifiers are included.
  candidates: { categories: import("./search").SearchCategory[]; band: "near" | "expanded";
    outcome: "NOT_ROUTE_SELECTED" | "ROUTE_FAILED" | "OVER_TRAVEL_BUDGET" | "HARD_INFEASIBLE" | "HARD_FEASIBLE";
    failureChecks: string[]; outboundStatus?: "success" | "no_route" | "timeout" | "provider_error";
    returnStatus?: "success" | "no_route" | "timeout" | "provider_error" }[];
};
