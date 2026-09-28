import type { CandidatePlan, Recommendation, ReturnMode } from "./model";
import type { SearchCategory } from "../contracts/search";

export type Goal = "flexible" | "rest" | "walk" | "discover";
export type Strength = "MUST" | "PREFER" | "DONT_CARE";
export type Preference = "lowCost" | "lowWalking" | "quiet" | "indoor" | "novelty";
export type Preferences = Partial<Record<Preference, Strength>>;
export type NormalizedIntent = {
  goal: Goal;
  goalSource: string;
  availableMinutes: number;
  returnMode: ReturnMode;
  preferences: Record<Preference, Strength>;
  maxWalkingMinutes?: { strength: "MUST"; value: number };
};
export type Evidence = {
  state: "MATCH" | "MISMATCH" | "UNKNOWN";
  source: string;
  reason: string;
  knownness: "known" | "unknown";
};
export type DimensionId = "needMatch" | "mobilityBurden" | "rating" | "price" | "activityOpportunity" | "costFit" | "quietFit" | "environmentFit" | "noveltyFit";
export type Dimension = { direction: "maximize" | "minimize"; value: number | null; evidence: Evidence };
export type HardCheck = { check: string; result: "passed" | "failed"; evidence: string };
export type StrategyId = "easy" | "balanced" | "explore";
export type StrategyEvaluation = {
  eligible: boolean;
  selected: boolean;
  reason: string;
  comparisonDimensions: DimensionId[];
  omittedUnknownDimensions: DimensionId[];
  distanceToIdeal?: number;
  experienceGain?: number;
};
export type DecisionTrace = {
  travelMode: import("../contracts/map").TravelMode;
  algorithmVersion: "0.3";
  decisionEngineRevision: string;
  goalMatch: {
    classification: "PRIMARY_MATCH" | "FALLBACK_MATCH" | "STRONG" | "MEDIUM" | "WEAK" | "UNKNOWN";
    primaryMatchInInputPool: boolean;
    primaryMatchExists: boolean;
    degraded: boolean;
    fallbackReason?: "NO_PRIMARY_MATCH_IN_INPUT_POOL" | "NO_FEASIBLE_PRIMARY_MATCH" | "WEAK_OR_UNKNOWN_GOAL_MATCH";
  };
  normalizedIntent: NormalizedIntent;
  hardConstraints: HardCheck[];
  activeDimensions: DimensionId[];
  evidence: Partial<Record<Preference, Evidence>>;
  dimensions: Partial<Record<DimensionId, Dimension>>;
  knownness: { known: number; active: number; role: "uncertainty-only" };
  pareto: {
    enabled?: false;
    dominated: boolean;
    dominatedBy: string[];
    comparableDimensions: DimensionId[];
    comparisons: { candidateId: string; comparableDimensions: DimensionId[]; blockedByUnknown: DimensionId[]; strictlyBetterDimensions: DimensionId[]; dominates: boolean }[];
    retainedReason: string;
  };
  strategy: Record<StrategyId, StrategyEvaluation>;
  uncertainties: string[];
  selectionReason: string;
};
export type EvaluatedCandidate = {
  plan: CandidatePlan;
  categories: SearchCategory[];
  categorySource: "discovery" | "mock-rule" | "unknown";
  trace: DecisionTrace;
};
export type DecisionResult = {
  supplyAudit: { travelMode: import("../contracts/map").TravelMode; candidateCount: number; feasibleCount: number; paretoCount: number; collapse: boolean };
  status: "ok" | "invalid_intent" | "unsupported_must";
  recommendations: Recommendation[];
  candidates: EvaluatedCandidate[];
  rejected: { candidateId: string; checks: HardCheck[] }[];
  diagnostics: { code: string; reason: string;
    counts?: { inputCandidateCount: number; feasibleCandidateCount: number; paretoCandidateCount: number };
    frontierCandidateId?: string;
    dominance?: { candidateId: string; comparableDimensions: DimensionId[]; strictlyBetterDimensions: DimensionId[] }[];
  }[];
};
