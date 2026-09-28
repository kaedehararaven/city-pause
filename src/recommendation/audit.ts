import type { CandidateData, UserIntent } from "./model";
import type { DecisionResult } from "./decisionTypes";
import { routeMetrics } from "../contracts/map";
import { categoryEvidence, needMatch } from "./evidence";
import { normalizeIntent } from "./normalization";

// Explicit allowlist for local development inspection: never serialize raw data,
// provider IDs, endpoints, location, credentials or provider response objects.
export function recommendationAudit(intent: UserIntent, data: CandidateData, decision: DecisionResult) {
  const normalized = normalizeIntent(intent);
  return { minutes: intent.availableMinutes, goal: normalized.goal, source: data.source, mode: data.travelMode ?? "walking",
    originKind: data.origin.name === "公开测试起点" ? "public-test" : "other",
    counts: decision.supplyAudit,
    funnel: data.routePreparationAudit?.funnel,
    requests: data.routePreparationAudit?.requested, cached: data.routePreparationAudit?.cached,
    candidates: data.places.map(place => {
      const row = decision.candidates.find(c => c.plan.places.length === 1 && c.plan.places[0].providerId === place.providerId);
      const categories = categoryEvidence({ places: [place] }, data);
      const need = categories.complete ? needMatch(normalized.goal, categories.categories) : null;
      const route = data.routes.find(r => r.from.id === data.origin.id && r.to.id === place.providerId);
      return { name: place.name, categories: categories.categories, routeStatus: route?.status ?? "not-requested",
        seconds: route?.status === "success" ? routeMetrics(route).durationSeconds : null,
        meters: route?.status === "success" ? routeMetrics(route).distanceMeters : null,
        need, match: row?.trace.goalMatch.classification ?? "UNKNOWN",
        feasible: !!row, pareto: null, paretoEnabled: false,
        factors: row ? Object.fromEntries(Object.entries(row.trace.dimensions).map(([key, dimension]) => [key, dimension?.value])) : null,
        eliminatedBy: row?.trace.pareto.comparisons.filter(c => c.dominates).map(c => ({
          name: data.places.find(p => p.providerId === c.candidateId)?.name ?? "候选",
          advantages: c.strictlyBetterDimensions,
        })),
        rejected: decision.rejected.find(r => r.candidateId === place.providerId)?.checks.map(c => c.check),
        strategies: row ? { default: { selected: true, reason: "旧三策略已停用；进入统一推荐列表" } } : null,
        final: decision.recommendations.some(p => p.places.some(poi => poi.providerId === place.providerId)) };
    }),
    ui: decision.recommendations.map(p => ({ title: p.title, strategy: p.strategyId, minutes: p.travelMinutes,
      degraded: p.decisionTrace?.goalMatch.degraded, reason: p.strategyReason })),
  };
}
