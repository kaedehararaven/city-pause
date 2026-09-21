import type { SearchCategory } from "../contracts/search";
import type { CandidateData, CandidatePlan, Recommendation, UserIntent } from "./model";
import { profileFor } from "./searchPolicy";

type Strategy = Recommendation["strategyId"];
export type UtilityComponents = { preference: number; activity: number; mobility: number };
export type ScoreTrace = {
  version: "0.2";
  hardConstraints: "passed";
  categories: SearchCategory[];
  categorySource: "discovery" | "mock-rule" | "unknown";
  components: UtilityComponents;
  preferenceContribution: number;
  activityContribution: number;
  mobilityContribution: number;
  baseUtility: number;
  qualityThreshold: number;
  strategyAdjustment: number;
  diversityAdjustment: number;
  selectionScore: number;
};
export type ScoredPlan = {
  plan: CandidatePlan;
  categories: SearchCategory[];
  categorySource: ScoreTrace["categorySource"];
  components: UtilityComponents;
  utility: number;
};

// Product preference rules, not discovery priority or provider facts.
const preferred: Record<ReturnType<typeof profileFor>, readonly SearchCategory[]> = {
  default: [], browsing: ["bookstore", "mall"], rest: ["cafe", "dessert", "mall"],
  walking: ["park"], refreshment: ["cafe", "dessert", "mall"],
};
export function preferenceMatch(intent: UserIntent, categories: readonly SearchCategory[]): number {
  const profile = profileFor(intent);
  if (profile === "default") return 0.7;
  if (!categories.length) return 0.5; // Unknown is neutral, not false or a rejection.
  return categories.some(category => preferred[profile].includes(category)) ? 1 : 0.35;
}
// Most value accrues in the first 15 minutes, then growth slows and caps at 35.
export function activityBenefit(minutes: number): number {
  return 0.7 * Math.min(Math.max(minutes, 0), 15) / 15 +
    0.3 * Math.min(Math.max(minutes - 15, 0), 20) / 20;
}
export function mobilityBurden(minutes: number, budget: number): number {
  return Math.min(1, Math.max(0, minutes / budget));
}
export function utilityScore(components: UtilityComponents): number {
  return 40 * components.preference + 30 * components.activity - 20 * components.mobility;
}
export function qualityThreshold(items: readonly ScoredPlan[]): number {
  return Math.max(0, Math.max(...items.map(item => item.utility)) - 18);
}
export function qualityGate(items: readonly ScoredPlan[]): ScoredPlan[] {
  const threshold = qualityThreshold(items);
  return items.filter(item => item.utility >= threshold);
}

const mockKinds: Record<string, SearchCategory | undefined> = {
  book: "bookstore", bookstore: "bookstore", mall: "mall", cafe: "cafe",
  dessert: "dessert", park: "park", garden: "park",
};
export function scorePlan(plan: CandidatePlan, intent: UserIntent, data: CandidateData): ScoredPlan {
  const categories = [...new Set(plan.places.flatMap(place => {
    if (data.source === "mock") return mockKinds[place.kind ?? ""] ? [mockKinds[place.kind ?? ""]!] : [];
    return data.discoveredCandidates?.find(candidate =>
      candidate.poi.source === "real" && candidate.poi.provider === place.provider &&
      candidate.poi.providerId === place.providerId &&
      candidate.poi.location.latitude === place.location.latitude &&
      candidate.poi.location.longitude === place.location.longitude &&
      candidate.poi.location.coordinateSystem === place.location.coordinateSystem)?.matchedSearchCategories ?? [];
  }))].sort();
  const components = {
    preference: preferenceMatch(intent, categories), activity: activityBenefit(plan.stayMinutes),
    mobility: mobilityBurden(plan.walkingMinutes, plan.budgetMinutes),
  };
  return { plan, categories, categorySource: categories.length ? data.source === "mock" ? "mock-rule" : "discovery" : "unknown",
    components, utility: utilityScore(components) };
}

function overlap(a: readonly string[], b: readonly string[]): number {
  if (!a.length || !b.length) return 0;
  const left = new Set(a), right = new Set(b);
  return [...left].filter(value => right.has(value)).length / new Set([...left, ...right]).size;
}
export function similarity(a: ScoredPlan, b: ScoredPlan): number {
  const ids = (item: ScoredPlan) => item.plan.places.map(p => JSON.stringify([p.provider, p.providerId]));
  return Math.max(overlap(ids(a), ids(b)), overlap(a.categories, b.categories));
}
export function strategyAdjustment(item: ScoredPlan, strategy: Strategy, intent: UserIntent): number {
  // Preserve the low-switching easy strategy without making station count a hard filter.
  if (strategy === "easy") return -8 * item.components.mobility - 8 * (item.plan.places.length - 1);
  if (strategy === "balanced") return intent.activity === "rest" ? 4 * item.components.activity : item.plan.places.length === 2 ? 8 : 0;
  return 4 * item.components.mobility + (item.plan.places.length === 2 && item.categories.length >= 2 ? 8 : 0);
  // Explore reduces the net mobility penalty from 20 to 16; longer transit never earns net benefit.
}
export function selectDiverse(
  items: readonly ScoredPlan[], selected: readonly ScoredPlan[], strategy: Strategy, intent: UserIntent,
): { item: ScoredPlan; diversityAdjustment: number; strategyAdjustment: number; selectionScore: number } | undefined {
  const signature = (item: ScoredPlan) => JSON.stringify(item.plan.places.map(p => [p.provider, p.providerId]).sort());
  const used = new Set(selected.map(signature));
  return items.filter(item => !used.has(signature(item))).map(item => {
    const adjustment = strategyAdjustment(item, strategy, intent);
    const diversity = -8 * Math.max(0, ...selected.map(previous => similarity(item, previous)));
    return { item, diversityAdjustment: diversity, strategyAdjustment: adjustment,
      selectionScore: item.utility + adjustment + diversity };
  }).sort((a, b) => b.selectionScore - a.selectionScore || b.item.utility - a.item.utility ||
    (a.item.plan.id < b.item.plan.id ? -1 : a.item.plan.id > b.item.plan.id ? 1 : 0))[0];
}
