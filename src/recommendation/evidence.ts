import { routeMetrics } from "../contracts/map";
import type { SearchCategory } from "../contracts/search";
import type { CandidateData, CandidatePlace, CandidatePlan } from "./model";
import type { Dimension, DimensionId, EvaluatedCandidate, Evidence, Goal, HardCheck, NormalizedIntent, Preference, StrategyEvaluation } from "./decisionTypes";
import { merchantPrice, ratingFor } from "./factors";

export function categoryEvidence(plan: Pick<CandidatePlan, "places">, data: CandidateData) {
  const perPlace = plan.places.map(place => data.discoveredCandidates?.find(candidate =>
    candidate.poi.provider === place.provider && candidate.poi.providerId === place.providerId)?.matchedSearchCategories ?? []);
  return { categories: [...new Set(perPlace.flat())].sort(), complete: perPlace.every(categories => categories.length > 0) };
}
export function evidence(state: Evidence["state"], source: string, reason: string): Evidence {
  return { state, source, reason, knownness: state === "UNKNOWN" ? "unknown" : "known" };
}
// Goal Match is intentionally unresolved until product defines a verified
// mapping. Category discovery is exposed as evidence, never as a hidden score.
export function needMatch(_goal: Goal, _categories: readonly SearchCategory[]): number | null { return null; }
export const isPrimaryMatch = (_goal: Goal, _need: number | null) => false;

function placeCost(place: CandidatePlace): Evidence {
  if (place.costRequired !== undefined) return evidence(place.costRequired ? "MISMATCH" : "MATCH", "CandidatePlace.costRequired", "使用上游显式费用声明");
  const raw = place.priceText?.trim();
  if (raw && /^(免费开放|免费入场|免门票)$/.test(raw)) return evidence("MATCH", `${place.source}:MapPOI.priceText`, `价格原文：${raw}`);
  return evidence("UNKNOWN", `${place.source}:MapPOI.priceText`, "费用缺失或口径不足，保留候选");
}
function costEvidence(plan: CandidatePlan): Evidence {
  const items = plan.places.map(placeCost);
  return evidence(items.some(i => i.state === "MISMATCH") ? "MISMATCH" : items.every(i => i.state === "MATCH") ? "MATCH" : "UNKNOWN",
    [...new Set(items.map(i => i.source))].join(";"), items.map(i => i.reason).join("; "));
}
const preferenceDimensions = { lowCost: "costFit", quiet: "quietFit", indoor: "environmentFit", novelty: "noveltyFit" } as const;
const valueOf = (item: Evidence) => item.state === "UNKNOWN" ? null : item.state === "MATCH" ? 1 : 0;
const blankStrategy = (): StrategyEvaluation => ({ eligible: false, selected: false, reason: "旧三策略已停用", comparisonDimensions: [], omittedUnknownDimensions: [] });

export function evaluateCandidate(plan: CandidatePlan, input: NormalizedIntent, data: CandidateData, checks: HardCheck[]): EvaluatedCandidate {
  const { categories, complete } = categoryEvidence(plan, data);
  const cost = costEvidence(plan);
  const level = plan.goalMatch ? { S: "STRONG", M: "MEDIUM", W: "WEAK" }[plan.goalMatch] as "STRONG" | "MEDIUM" | "WEAK" : "UNKNOWN";
  const dimensions: Partial<Record<DimensionId, Dimension>> = {
    needMatch: { direction: "maximize", value: null, evidence: evidence(plan.goalMatch ? "MATCH" : "UNKNOWN", "v3:classified_poi_tag", level) },
    mobilityBurden: { direction: "minimize", value: plan.travelDurationSeconds, evidence: evidence("MATCH", `${plan.source}:RouteResult`, `${plan.travelDurationSeconds} 秒移动；非总分`) },
    rating: { direction: "maximize", value: ratingFor(plan), evidence: evidence(ratingFor(plan) === null ? "UNKNOWN" : "MATCH", "MapPOI.rating", "百度评分，缺失保持未知") },
    price: { direction: "minimize", value: merchantPrice(plan.places[0].priceText), evidence: evidence(merchantPrice(plan.places[0].priceText) === null ? "UNKNOWN" : "MATCH", "MapPOI.priceText", "百度数值商户价格，不推断门票或免费") },
  };
  const preferences: Partial<Record<Preference, Evidence>> = { lowCost: cost };
  const activeDimensions = Object.keys(dimensions) as DimensionId[];
  return { plan, categories, categorySource: complete ? "discovery" : "unknown", trace: {
    travelMode: plan.travelMode, algorithmVersion: "0.3", decisionEngineRevision: "simple-0.1",
    goalMatch: { classification: level, primaryMatchInInputPool: false, primaryMatchExists: false, degraded: false },
    normalizedIntent: input, hardConstraints: checks, activeDimensions, evidence: preferences, dimensions,
    knownness: { known: activeDimensions.filter(key => dimensions[key]!.value !== null).length, active: activeDimensions.length, role: "uncertainty-only" },
    pareto: { enabled: false, dominated: false, dominatedBy: [], comparableDimensions: [], comparisons: [], retainedReason: "Pareto 已停用；所有硬约束可行候选进入排序" },
    strategy: { easy: blankStrategy(), balanced: blankStrategy(), explore: blankStrategy() }, uncertainties: plan.goalMatch ? [] : ["goalMatch: 缺少已验证的 v3 等级"], selectionReason: "默认排序",
  } };
}
