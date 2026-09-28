import type { DiscoverySnapshot, DiscoveredCandidate } from "../contracts/discovery";
import { passesTravelGate, travelLimitSeconds, type CandidateFunnel, type FunnelCounts, type RoutePreparationAudit } from "../contracts/mobility";
import { routeMetrics, type TravelMode } from "../contracts/map";
import { SEARCH_CATEGORIES } from "../contracts/search";
import type { CandidateData, UserIntent } from "../recommendation/model";
import { buildDecisionResult } from "../recommendation/engine";
import { normalizeIntent } from "../recommendation/normalization";

const latest = new Map<TravelMode, RoutePreparationAudit>();
export const readLatestRouteAudit = (mode: TravelMode = "walking") => structuredClone(latest.get(mode));
export const clearLatestRouteAudit = (mode: TravelMode) => { latest.delete(mode); };
export class RoutePreparationError extends Error {
  constructor(message: string, public readonly audit: RoutePreparationAudit) { super(message); }
}
const identity = (candidate: DiscoveredCandidate) => JSON.stringify([candidate.poi.provider, candidate.poi.providerId]);
const empty = (): FunnelCounts => ({ discovered: 0, routeSelected: 0, routeSuccess: 0, travelGatePass: 0, hardFeasible: 0, deliveredPrimary: 0 });

export function attachCandidateFunnel(intent: UserIntent, snapshot: DiscoverySnapshot, data: CandidateData, audit: RoutePreparationAudit) {
  // Consume A's existing hard-check output; never duplicate its feasibility or ranking policy.
  const decision = buildDecisionResult(intent, data);
  const observed = snapshot.result.observations;
  const universe = new Map((observed?.uniqueCandidates ?? snapshot.result.candidates).map(c => [identity(c), c]));
  const selected = new Set(data.discoveredCandidates?.map(identity));
  const feasible = new Map(decision.candidates.filter(c => c.plan.places.length === 1).map(c => [c.plan.places[0].providerId, c]));
  const counts = empty();
  const byCategory = Object.fromEntries(SEARCH_CATEGORIES.map(c => [c, empty()])) as CandidateFunnel["byCategory"];
  const candidates: CandidateFunnel["candidates"] = [];
  for (const candidate of universe.values()) {
    const id = candidate.poi.providerId;
    const chosen = selected.has(identity(candidate));
    const outbound = data.routes.find(r => r.from.id === data.origin.id && r.to.id === id);
    const back = data.routes.find(r => r.from.id === id && r.to.id === data.origin.id);
    const success = outbound?.status === "success" && (intent.returnMode !== "return_to_start" || back?.status === "success");
    const gate = success && passesTravelGate(intent, routeMetrics(outbound).durationSeconds,
      back?.status === "success" ? routeMetrics(back).durationSeconds : undefined);
    const hard = feasible.get(id);
    const overOutbound = outbound?.status === "success" && routeMetrics(outbound).durationSeconds > travelLimitSeconds(intent);
    const failureChecks = decision.rejected.find(c => c.candidateId === id)?.checks.map(c => c.check) ?? [];
    const outcome = !chosen ? "NOT_ROUTE_SELECTED" : overOutbound ? "OVER_TRAVEL_BUDGET" : !success ? "ROUTE_FAILED" :
      !gate ? "OVER_TRAVEL_BUDGET" : !hard ? "HARD_INFEASIBLE" : "HARD_FEASIBLE";
    candidates.push({ categories: candidate.matchedSearchCategories, band: candidate.discoveryBand ?? "near", outcome, failureChecks,
      outboundStatus: outbound?.status, returnStatus: back?.status });
    for (const target of [counts, ...candidate.matchedSearchCategories.map(c => byCategory[c]!)]) {
      target.discovered++;
      if (chosen) target.routeSelected++;
      if (success) target.routeSuccess++;
      if (gate) target.travelGatePass++;
      if (hard) target.hardFeasible++;
      if (hard?.trace.goalMatch.classification === "PRIMARY_MATCH") target.deliveredPrimary++;
    }
  }
  const park = byCategory.park!;
  const parks = candidates.filter(c => c.categories.includes("park"));
  const parkOutcome: CandidateFunnel["parkOutcome"] = !park.discovered ? "NO_PARK_DISCOVERED" : !park.routeSelected ? "PARK_NOT_ROUTE_SELECTED" :
    park.hardFeasible ? "PARK_DELIVERED_TO_A" : park.travelGatePass ? "PARK_HARD_INFEASIBLE" :
    parks.some(p => p.outcome === "OVER_TRAVEL_BUDGET") ? "PARK_OVER_TRAVEL_BUDGET" : "PARK_ROUTE_FAILED";
  audit.funnel = { travelMode: audit.travelMode, availableMinutes: intent.availableMinutes, returnMode: intent.returnMode,
    travelLimitSeconds: travelLimitSeconds(intent), goal: normalizeIntent(intent).goal,
    searchedQueries: observed?.searchedQueries ?? snapshot.result.categories.length,
    searchStatus: snapshot.result.status,
    failedSearchCategories: snapshot.result.categories.filter(c => c.status === "timeout" || c.status === "provider_error").map(c => c.category),
    discoveredObservations: observed?.validCount ?? null, deduped: observed?.uniqueCandidates.length ?? null,
    retained: snapshot.result.candidates.length, counts, byCategory, parkOutcome, candidates };
  data.routePreparationAudit = audit;
  latest.set(audit.travelMode, structuredClone(audit));
}
